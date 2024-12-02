const express = require("express");
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");
const ExcelJS = require("exceljs");

// Load environment variables
require("dotenv").config();

if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: Missing OPENAI_API_KEY in .env file.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const upload = multer({ dest: "uploads/" });

app.set("view engine", "ejs");
app.use(express.static("public"));

// Full prompt with all codes, descriptions, and examples
const codebook = `
You are a Human-Computer Interaction researcher analyzing articles selected for a Systematic Literature Review. 

Label the attached paper using as many labels as necessary and indicate which sentences/quotes the labels correspond to. 

Do not analyze sections with titles such as "Related Works," "Literature Review," "Theoretical Background," "State of the Art," "Background," "Review of the Literature," "Research Background," "Previous Studies," "Existing Literature," "Knowledge Base," "Foundation of the Study," "Research Context," or "Analysis of Related Research." 

Instructions: 
* Respond only with raw text excerpts from the article that illustrate the identified labels. 
* Do not provide summaries, interpretations, or explanations. 
* Extract the text exactly as it appears in the article, preserving the original structure, grammar, and phrasing. 
* Include as many excerpts as necessary to comprehensively represent the labels. 
* If no labels are identifiable in certain parts of the article, omit those sections from the response. 
* The goal is to extract and present relevant raw excerpts that objectively represent the identified labels throughout the article.
`;


// Function to process PDF and extract text
async function extractTextFromPdf(pdfPath) {
    const dataBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(dataBuffer);
    return pdfData.text;
}

// Function to process text with GPT API
async function processWithGPT(text, paperName) {
    const prompt = `${codebook}\n\nThe text is:\n${text}\n\nGuidelines: Extract text strictly from the provided source. Do not create, infer, or modify text beyond what is explicitly stated.`;
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            temperature: 0.2,
            messages: [{
                    role: "system",
                    content: "You are a precise and detail-oriented assistant. Use the provided examples as a guide, but only extract text explicitly stated in the provided content. Do not generate or imagine text beyond the source material.",
                },
                {
                    role: "user",
                    content: prompt
                },
            ],
        });

        if (
            !response ||
            !response.choices ||
            !response.choices[0] ||
            !response.choices[0].message
        ) {
            console.error("Invalid response from OpenAI API.");
            return [];
        }

        // Parse GPT response into results
        const results = response.choices[0].message.content.split("\n").map((line) => {
            const [label, ...extractionParts] = line.split(":");
            return {
                paperName,
                label: label.trim(),
                excerpt: extractionParts.join(":").trim(),
            };
        });

        return results;
    } catch (error) {
        console.error("Error with OpenAI API:", error.response ?.data || error.message);
        return [];
    }
}

// Function to generate Excel file
async function generateExcel(results) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Results");

    // Add header row
    worksheet.columns = [{
            header: "Paper Name",
            key: "paperName",
            width: 30
        },
        {
            header: "Excerpt",
            key: "excerpt",
            width: 50
        },
        {
            header: "Label",
            key: "label",
            width: 15
        },
    ];

    // Add data rows
    let firstRow = true; // To handle the first occurrence of Paper Name
    let lastCode = "";
    results.forEach((result) => {

        if (result.label.includes("**")) {
            lastCode = result.label;
        }

        if (!result.label.includes("**") && result.label != "") {
            worksheet.addRow({
                paperName: firstRow ? result.paperName : "",
                excerpt: result.label,
                label: lastCode,
            });
            //firstRow = false; // Ensure subsequent rows for the same paper omit the name
        }

    });

    const filePath = `results-${Date.now()}.xlsx`;
    await workbook.xlsx.writeFile(filePath);
    return filePath;
}

// Route to render the upload page
app.get("/", (req, res) => {
    res.render("index");
});

// Route to handle file upload and processing
app.post("/upload", upload.single("pdf"), async (req, res) => {
    if (!req.file) {
        return res.status(400).send("No file uploaded.");
    }

    const pdfPath = req.file.path;
    const paperName = req.file.originalname;

    try {
        // Extract text from PDF
        const pdfText = await extractTextFromPdf(pdfPath);

        // Process text with GPT
        const results = await processWithGPT(pdfText, paperName);

        // Generate Excel file
        const filePath = await generateExcel(results);

        // Send the file for download
        res.download(filePath, (err) => {
            if (err) {
                console.error("Error sending file:", err);
                res.status(500).send("Error generating or sending the file.");
            }

            // Clean up the generated file
            fs.unlinkSync(filePath);
        });
    } catch (error) {
        console.error("Error processing file:", error.message);
        res.status(500).send("An error occurred while processing the file.");
    } finally {
        // Clean up uploaded file
        fs.unlinkSync(pdfPath);
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});