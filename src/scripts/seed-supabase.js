import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carregar variáveis de ambiente manualmente do .env.local
const envPath = path.resolve(__dirname, '../../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) env[key.trim()] = value.trim();
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
    console.log('--- Iniciando Migração de Dados ---');
    
    const dataPath = path.resolve(__dirname, '../data/data.json');
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const payments = JSON.parse(rawData);

    console.log(`Encontrados ${payments.length} registros para subir.`);

    // Subir em lotes de 500 para não estourar limite de payload
    const batchSize = 500;
    for (let i = 0; i < payments.length; i += batchSize) {
        const batch = payments.slice(i, i + batchSize).map(p => ({
            vencimento: p.vencimento,
            nome: p.nome,
            descricao: p.descricao,
            documento: p.documento,
            valor: p.valor,
            observacao: p.observacao,
            data_movimento: p.data_movimento,
            source: 'native'
        }));

        const { error } = await supabase
            .from('payments')
            .insert(batch);

        if (error) {
            console.error(`Erro no lote ${i / batchSize}:`, error);
        } else {
            console.log(`Lote ${i / batchSize + 1} enviado com sucesso (${i + batch.length}/${payments.length})`);
        }
    }

    console.log('--- Migração Concluída ---');
}

seed();
