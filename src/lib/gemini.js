import { GoogleGenerativeAI } from "@google/generative-ai";

// Lê a chave diretamente do seu .env.local
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export const extractTableFromImage = async (base64Image, mimeType) => {
    if (!API_KEY) {
        throw new Error("VITE_GEMINI_API_KEY não está configurada no ambiente (crie no seu .env.local).");
    }

    const genAI = new GoogleGenerativeAI(API_KEY);
    // Modelo leve e muito rápido para visão e extração:
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 

    const prompt = `Você é um extrator de dados de planilhas e tabelas financeiras.
    Analise a imagem enviada (um print de uma tabela de pagamentos) e extraia TODAS as linhas de dados da tabela.
    
    A tabela costuma ter colunas como: DATA, CLASSIFICAÇÃO, DESCRIÇÃO, NOME, VALOR, VENCIMENTO, FORMA DE PAGAMENTO.
    
    Regras estritas de saída:
    1. Retorne APENAS um array JSON válido. Sem formatação Markdown (não use \`\`\`json).
    2. Cada objeto do JSON deve ter as exatas chaves abaixo. Se algo faltar na linha, use string vazia "":
       - "vencimento" (string no formato DD/MM/YYYY)
       - "classificacao" (string - ex: "COMPRAS", "TERCEIROS", "OUTROS", "URGENTE")
       - "descricao" (string representativa do lançamento)
       - "nome" (string do fornecedor)
       - "valor" (number, ex: 150.50. Remova "R$", pontos de milhar, repasse vírgulas p/ float puro)
       - "observacao" (string da Forma de Pagamento ou notas, limite 250 chars)
       
    Concentre-se em extrair o conteúdo principal. Ignore totais em rodapés se não forem itens pagáveis individuais.`;

    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: base64Image,
                mimeType
            }
        }
    ]);

    const responseText = result.response.text();
    
    // Tratamento de segurança caso o modelo insista em colocar markers do markdown
    try {
        let cleanText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const jsonData = JSON.parse(cleanText);
        return jsonData;
    } catch (error) {
        console.error("JSON Error:", responseText);
        throw new Error("A IA não conseguiu estruturar um JSON válido a partir desta imagem. Tente uma foto com melhor qualidade.");
    }
};
