import * as XLSX from 'xlsx';

/**
 * Converte string DD/MM/YYYY para YYYY-MM-DD para comparação/ordenação.
 * Também suporta números seriais de data do Excel.
 * @param {string|number} dateStr
 * @returns {string} data no formato YYYY-MM-DD ou string vazia
 */
export const parseDateString = (dateStr) => {
    if (!dateStr) return '';
    if (typeof dateStr === 'number') {
        // Número serial do Excel
        const date = XLSX.SSF.parse_date_code(dateStr);
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }
    const parts = String(dateStr).split('/');
    if (parts.length !== 3) return '';
    return `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
};

/**
 * Converte strings de valor monetário importadas para número.
 * Suporta formatos como "R$ 1.234,56" ou "1234.56".
 * @param {string|number} valStr
 * @returns {number}
 */
export const parseCurrency = (valStr) => {
    if (typeof valStr === 'number') return valStr;
    if (!valStr) return 0;
    const str = String(valStr).replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
    return parseFloat(str) || 0;
};

/**
 * Normaliza texto: lowercase, sem acentos, sem espaços extras.
 * @param {string} text
 * @returns {string}
 */
export const normalizeText = (text) => {
    if (!text) return '';
    return String(text).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

/**
 * Identifica o cartão de crédito a partir do campo documento.
 * @param {string} doc
 * @returns {string|null} chave do cartão ou null
 */
export const identifyCard = (doc) => {
    if (!doc) return null;
    const s = normalizeText(doc);
    if (s.includes('caixa black mauro') || s.includes('cx black mauro')) return 'CX_BLACK_MAURO';
    if (s.includes('elo nanquim mauro')) return 'ELO_NANQUIM_MAURO';
    if (s.includes('caixa black junior') || s.includes('caixa black jr') || s.includes('cx black junior') || s.includes('cx black jr')) return 'CX_BLACK_JR';
    if (s.includes('elo nanquim junior') || s.includes('elo nanquim jr')) return 'ELO_NANQUIM_JR';
    return null;
};

/**
 * Formata número para moeda BRL.
 * @param {number} value
 * @returns {string}
 */
export const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

/**
 * Converte data serial do Excel para string DD/MM/YYYY.
 * Se já for string, retorna sem modificação.
 * @param {number|string} excelDate
 * @returns {string}
 */
export const formatExcelDate = (excelDate) => {
    if (!excelDate) return '';
    if (typeof excelDate === 'number') {
        const d = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
        return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    }
    return String(excelDate).trim();
};
