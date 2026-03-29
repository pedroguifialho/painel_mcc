import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseCurrency, normalizeText } from '../lib/utils';
import { BATCH_SIZE, HEADER_KEYWORDS } from '../constants';
import { UploadCloud, Loader2, FileBarChart, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

const ImportacaoGeral = ({ dbDataCount, onImportSuccess }) => {
    const [isReseting, setIsReseting] = useState(false);

    const processData = async (rows, fileName) => {
        try {
            if (!rows || rows.length < 2) {
                alert('O arquivo parece estar vazio ou não contém dados suficientes.');
                return;
            }

            console.log(`Processando ${rows.length} linhas de ${fileName}`);

            // 1. Localizar Cabeçalho
            let headerIdx = -1;
            const keywords = HEADER_KEYWORDS;

            for (let i = 0; i < Math.min(rows.length, 20); i++) {
                const row = rows[i];
                if (!row) continue;
                
                // Converte a linha para uma string única para busca de palavras-chave
                const lineContent = Array.isArray(row) 
                    ? row.map(c => normalizeText(c)).join(' ')
                    : Object.values(row).map(c => normalizeText(c)).join(' ');

                const matches = keywords.filter(k => lineContent.includes(k)).length;
                if (matches >= 2) {
                    headerIdx = i;
                    break;
                }
            }

            if (headerIdx === -1) {
                console.error("Amostra das primeiras linhas:", rows.slice(0, 5));
                alert('Não foi possível localizar o cabeçalho (Nome, Valor, Vencimento). Verifique o arquivo.');
                return;
            }

            const rawHeaders = Array.isArray(rows[headerIdx]) ? rows[headerIdx] : Object.keys(rows[headerIdx]);
            const headers = rawHeaders.map(h => normalizeText(h));

            const findCol = (possibleNames) => {
                return headers.findIndex(h => possibleNames.some(p => h.includes(p)));
            };

            const colIdx = {
                data_movimento: findCol(['data movimento', 'movimento', 'dt. mov']),
                documento: findCol(['documento', 'doc']),
                descricao: findCol(['descricao', 'detalhe']),
                nome: findCol(['nome', 'fornecedor', 'beneficiario']),
                valor: findCol(['valor', 'total', 'quantia']),
                vencimento: findCol(['vencimento', 'venc', 'dt. ven']),
                observacao: findCol(['observacao', 'obs', 'notas'])
            };

            console.log('Cabeçalho detectado na linha:', headerIdx + 1);
            console.log('Mapeamento:', colIdx);

            if (colIdx.nome === -1 || colIdx.valor === -1 || colIdx.vencimento === -1) {
                alert('Colunas obrigatórias não encontradas (Nome, Valor ou Vencimento).');
                return;
            }

            const dataRows = rows.slice(headerIdx + 1);
            const newRecords = dataRows
                .map((row, idx) => {
                    const cells = Array.isArray(row) ? row : rawHeaders.map(h => row[h]);
                    
                    const val = parseCurrency(cells[colIdx.valor]);
                    const venc = cells[colIdx.vencimento];
                    const nome = cells[colIdx.nome];

                    if (!venc || !nome || isNaN(val)) return null;

                    return {
                        data_movimento: String(cells[colIdx.data_movimento] || '').trim(),
                        documento: String(cells[colIdx.documento] || '').trim(),
                        descricao: String(cells[colIdx.descricao] || '').trim(),
                        nome: String(nome).trim(),
                        valor: val,
                        vencimento: String(venc).trim(),
                        observacao: String(cells[colIdx.observacao] || '').trim(),
                        source: fileName.endsWith('.csv') ? 'csv_import' : 'excel_import'
                    };
                })
                .filter(Boolean);

            if (newRecords.length === 0) {
                alert('Nenhum registro válido encontrado após o cabeçalho.');
                return;
            }

            if (window.confirm(`Detectados ${newRecords.length} registros válidos em "${fileName}".\n\nATENÇÃO: Deseja apagar o banco atual e importar estes novos dados?`)) {
                setIsReseting(true);
                const { error: delError } = await supabase.from('payments').delete().not('id', 'is', null);
                if (delError) throw delError;

                for (let i = 0; i < newRecords.length; i += BATCH_SIZE) {
                    const batch = newRecords.slice(i, i + BATCH_SIZE);
                    const { error: insError } = await supabase.from('payments').insert(batch);
                    if (insError) throw insError;
                }

                alert(`Sucesso! ${newRecords.length} registros importados.`);
                if (onImportSuccess) onImportSuccess();
            }
        } catch (err) {
            console.error('Erro no processamento:', err);
            alert('Erro: ' + err.message);
        } finally {
            setIsReseting(false);
        }
    };

    const handleFileImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const fileName = file.name.toLowerCase();
        const reader = new FileReader();

        if (fileName.endsWith('.csv')) {
            reader.onload = (event) => {
                const text = event.target.result;
                const lines = text.split(/\r?\n/).filter(l => l.trim());
                
                // Detectar separador
                const firstLine = lines[0] || "";
                const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
                
                const rows = lines.map(line => line.split(sep));
                processData(rows, file.name);
            };
            reader.readAsText(file, 'ISO-8859-1');
        } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            reader.onload = (event) => {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                processData(rows, file.name);
            };
            reader.readAsArrayBuffer(file);
        } else {
            alert('Formato de arquivo não suportatedo. Use .csv, .xlsx ou .xls');
        }
    };

    return (
        <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <div style={{ background: 'var(--color-primary-subtle)', padding: '0.5rem', borderRadius: '8px', color: 'var(--color-primary)' }}>
                    <UploadCloud size={24} />
                </div>
                <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Importação Geral (Tudo em Um)</h2>
            </div>
            
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Arraste ou selecione sua planilha geral (CSV ou Excel) para atualizar todo o dashboard. 
                <strong style={{ color: 'var(--color-danger)' }}> Isso limpa o banco de dados atual antes de importar.</strong>
            </p>

            <div style={{ background: 'rgba(0,0,0,0.05)', border: '2px dashed var(--color-border)', borderRadius: '16px', padding: '3rem 2rem', textAlign: 'center', transition: 'all 0.3s ease' }}>
                <input
                    type="file"
                    id="universal-upload"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileImport}
                    style={{ display: 'none' }}
                    disabled={isReseting}
                />
                <label htmlFor="universal-upload" style={{ cursor: isReseting ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
                    <div style={{ width: '64px', height: '64px', borderRadius: '20px', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
                        {isReseting ? (
                            <Loader2 className="animate-spin" size={32} color="var(--color-primary)" />
                        ) : (
                            <div style={{ position: 'relative' }}>
                                <FileSpreadsheet size={32} color="var(--color-success)" />
                                <div style={{ position: 'absolute', top: -10, right: -10, background: 'var(--color-primary)', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--color-surface)' }}>
                                    <UploadCloud size={10} color="white" />
                                </div>
                            </div>
                        )}
                    </div>
                    <div>
                        <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-text-base)', display: 'block', marginBottom: '0.25rem' }}>
                            {isReseting ? 'Processando dados...' : 'Clique para selecionar Planilha'}
                        </span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                            Formatos suportados: .csv, .xlsx, .xls
                        </span>
                    </div>
                </label>
            </div>
        </div>
    );
};

export default ImportacaoGeral;
