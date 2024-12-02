const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Certifique-se de que sua chave está correta no .env
});

(async () => {
  try {
    const response = await openai.models.list(); // Chamada ajustada para listar os modelos
    console.log("Modelos disponíveis:", response.data);
  } catch (error) {
    console.error("Erro ao conectar à API OpenAI:", error.message);
  }
})();
