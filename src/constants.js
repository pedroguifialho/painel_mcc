/**
 * Classificações válidas de lançamentos.
 */
export const CLASSIFICATIONS = ['COMPRAS', 'TERCEIROS', 'URGENTE', 'URGENTES', 'OUTROS'];

/**
 * Classificações exibidas nos filtros e formulários (sem duplicatas de urgente).
 */
export const CLASSIFICATION_OPTIONS = ['COMPRAS', 'TERCEIROS', 'URGENTE', 'OUTROS'];

/**
 * Cartões de crédito registrados no sistema.
 */
export const CARDS = [
    { key: 'CX_BLACK_MAURO', label: 'Caixa Black Mauro' },
    { key: 'ELO_NANQUIM_MAURO', label: 'Elo Nanquim Mauro' },
    { key: 'CX_BLACK_JR', label: 'Caixa Black Jr' },
    { key: 'ELO_NANQUIM_JR', label: 'Elo Nanquim Jr' },
];

/**
 * Abas disponíveis no sistema.
 */
export const TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'reports', label: 'Relatórios' },
    { id: 'cards', label: 'Cartões' },
    { id: 'renegotiation', label: 'Renegociação' },
    { id: 'payment-lists', label: 'Listas de Pagamento' },
    { id: 'audit', label: 'Histórico' },
    { id: 'import', label: 'Importação' },
];

/**
 * Email do administrador com acesso ao painel admin.
 */
export const ADMIN_EMAIL = 'pedro.gui.fialho@gmail.com';

/**
 * Tamanho do lote para inserções em massa no Supabase.
 */
export const BATCH_SIZE = 500;

/**
 * Palavras-chave usadas para localizar cabeçalho em arquivos de importação.
 */
export const HEADER_KEYWORDS = ['vencimento', 'valor', 'nome', 'descrição', 'descricao'];

/**
 * Cores para gráficos.
 */
export const CHART_COLORS = [
    '#f97316', '#3b82f6', '#8b5cf6', '#10b981', '#ef4444',
    '#06b6d4', '#ec4899', '#f59e0b', '#14b8a6', '#6366f1',
    '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#22c55e',
    '#d946ef', '#f43f5e', '#0891b2', '#7c3aed', '#eab308',
];
