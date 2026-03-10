import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Login from './components/Login';
import AuditHistory from './components/AuditHistory';
// import nativeData from './data/data.json'; // Deprecated for Supabase
// import ddaData from './data/dda-imported.json'; // Deprecated for Supabase
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
    Cell, CartesianGrid, Legend
} from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    Search,
    LayoutDashboard,
    FileBarChart,
    CalendarDays,
    Users,
    TrendingUp,
    FilterX,
    UploadCloud,
    CheckCircle2,
    AlertCircle,
    Save,
    AlertTriangle,
    Clock,
    Sun,
    Moon,
    Download,
    ChevronLeft,
    ChevronRight,
    History
} from 'lucide-react';

// Utility to parse DD/MM/YYYY to YYYY-MM-DD for easier comparison
const parseDateString = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('/');
    if (parts.length !== 3) return '';
    return `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
};

// Utility to parse imported strings to number
const parseCurrency = (valStr) => {
    if (!valStr) return 0;
    let str = String(valStr).replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
    return parseFloat(str) || 0;
};

const App = () => {
    const [user, setUser] = useState(null);
    const [activeTab, setActiveTab] = useState('dashboard');
    const [searchTerm, setSearchTerm] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('');

    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [showOverdueOnly, setShowOverdueOnly] = useState(false);


    // --- THEME STATE ---
    const [isDarkMode, setIsDarkMode] = useState(() => {
        const saved = localStorage.getItem('theme');
        return saved === 'light' ? false : true;
    });

    useEffect(() => {
        localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
        // Apply theme to body so backgrounds outside .container are also themed
        if (isDarkMode) {
            document.body.classList.remove('light-theme');
        } else {
            document.body.classList.add('light-theme');
        }
    }, [isDarkMode]);

    // --- DDA IMPORT STATE ---
    const [isProcessingFile, setIsProcessingFile] = useState(false);
    // Preview now has: newRecords, divergentRecords, exactRecords
    const [ddaPreview, setDdaPreview] = useState(null);
    const [isSavingInProgress, setIsSavingInProgress] = useState(false);

    const [ddaIgnoredSuppliers, setDdaIgnoredSuppliers] = useState(() => {
        try { return JSON.parse(localStorage.getItem('ddaIgnoredSuppliers') || '[]'); }
        catch { return []; }
    });

    useEffect(() => {
        // Check current session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setUser(null);
    };

    const [localDdaData, setLocalDdaData] = useState([]);
    const [dbData, setDbData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [csvFile, setCsvFile] = useState(null);
    const [isReseting, setIsReseting] = useState(false);

    // 1. Fetch initial data from Supabase
    const fetchPayments = useCallback(async () => {
        setIsLoading(true);
        const { data, error } = await supabase
            .from('payments')
            .select('*')
            .order('vencimento', { ascending: true });

        if (error) {
            console.error('Error fetching payments:', error);
        } else {
            // Map DB fields to match current logic if needed
            const mapped = (data || []).map(item => ({
                ...item,
                valor: parseFloat(item.valor)
            }));
            setDbData(mapped);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        fetchPayments();

        // 2. Setup Realtime Subscription
        const channel = supabase
            .channel('public:payments')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
                fetchPayments(); // Refresh on any change
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchPayments]);

    // 3. Combine initial DB data and transient DDA Data
    const baseData = useMemo(() => {
        // Flag source
        const mappedDb = dbData.map(d => ({ ...d, source: d.source || 'native' }));
        const mappedLocalDda = localDdaData.map(d => ({ ...d, source: 'dda' }));

        const combined = [...mappedDb, ...mappedLocalDda];

        return combined.map(item => ({
            ...item,
            data_iso: parseDateString(item.vencimento),
            valor_fmt: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.valor),
        })).sort((a, b) => (a.data_iso || '').localeCompare(b.data_iso || ''));
    }, [dbData, localDdaData]);

    // 2. Apply global filters (Period, Search, Supplier) (For Dashboard/Reports only)
    const filteredData = useMemo(() => {
        if (activeTab === 'import') return []; // Don't compute mostly if not needed
        return baseData.filter(item => {
            const textMatches =
                (item.descricao || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (item.nome || '').toLowerCase().includes(searchTerm.toLowerCase());

            const supplierMatches = supplierFilter === '' || item.nome === supplierFilter;
            const afterStart = startDate === '' || item.data_iso >= startDate;
            const beforeEnd = endDate === '' || item.data_iso <= endDate;

            let isOverdue = true;
            if (showOverdueOnly) {
                const todayIso = new Date().toISOString().split('T')[0];
                isOverdue = item.data_iso < todayIso;
            }

            return textMatches && supplierMatches && afterStart && beforeEnd && isOverdue;
        });
    }, [baseData, searchTerm, supplierFilter, startDate, endDate, showOverdueOnly, activeTab]);

    const uniqueSuppliers = useMemo(() => {
        return [...new Set(baseData.map(item => item.nome))].sort();
    }, [baseData]);

    // 3. Calculating Aggregated Stats
    const stats = useMemo(() => {
        if (activeTab === 'import') return { total: 0, count: 0, suppliersCount: 0, topSuppliersChartData: [], dailyChartData: [] };
        const total = filteredData.reduce((acc, curr) => acc + curr.valor, 0);
        const count = filteredData.length;
        const suppliersCount = [...new Set(filteredData.map(item => item.nome))].length;

        let oldestOverdue = null;
        if (showOverdueOnly && filteredData.length > 0) {
            oldestOverdue = [...filteredData].sort((a, b) => a.data_iso.localeCompare(b.data_iso))[0];
        }

        const dialyTotals = filteredData.reduce((acc, curr) => {
            if (!curr.data_iso) return acc;
            acc[curr.vencimento] = (acc[curr.vencimento] || 0) + curr.valor;
            return acc;
        }, {});

        const dailyChartData = Object.keys(dialyTotals).map(date => ({
            date: date.substring(0, 5),
            fullDate: date,
            value: dialyTotals[date]
        }));

        const supplierTotals = filteredData.reduce((acc, curr) => {
            acc[curr.nome] = (acc[curr.nome] || 0) + curr.valor;
            return acc;
        }, {});

        const topSuppliersChartData = Object.keys(supplierTotals)
            .map(name => ({ name, value: supplierTotals[name] }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 20);

        return { total, count, suppliersCount, topSuppliersChartData, dailyChartData, oldestOverdue };
    }, [filteredData, activeTab, showOverdueOnly]);

    const COLORS = [
        '#f97316', '#3b82f6', '#8b5cf6', '#10b981', '#ef4444',
        '#06b6d4', '#ec4899', '#f59e0b', '#14b8a6', '#6366f1',
        '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#22c55e',
        '#d946ef', '#f43f5e', '#0891b2', '#7c3aed', '#eab308'
    ];
    const CHART_THEME = {
        textColor: 'var(--color-text-muted)',
        gridColor: 'var(--color-grid)',
        tooltipBg: 'var(--color-tooltip)',
        tooltipBorder: 'var(--color-border)'
    };
    const chartTextColor = isDarkMode ? '#94a3b8' : '#64748b'; // Fallback for some recharts props if var() fails

    const clearFilters = () => {
        setSearchTerm('');
        setSupplierFilter('');
        setStartDate('');
        setEndDate('');
        setShowOverdueOnly(false);
    };

    // --- SAT-FRI WEEK LOGIC ---
    const setSaturdayToFridayWeek = useCallback(() => {
        const today = new Date();
        const day = today.getDay(); // 0 (Sun) to 6 (Sat)

        // Target Saturday: if day is 6 (Sat), it's today. If < 6, it's (day + 1) days ago.
        const diffToSat = (day === 6) ? 0 : (day + 1);
        const saturday = new Date(today);
        saturday.setDate(today.getDate() - diffToSat);

        const friday = new Date(saturday);
        friday.setDate(saturday.getDate() + 6);

        setStartDate(saturday.toISOString().split('T')[0]);
        setEndDate(friday.toISOString().split('T')[0]);
    }, []);

    // --- EXPORT LOGIC ---
    const exportToPDF = () => {
        if (filteredData.length === 0) return alert('Sem dados para exportar.');

        // Helper: normalize text to avoid encoding issues (accent/cedilla support via latin1)
        const safe = (str) => (str || '').normalize('NFC');

        const doc = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4',
            putOnlyUsedFonts: true,
            compress: true
        });
        
        const dateNow = new Date().toLocaleDateString('pt-BR');

        // --- Page Header ---
        doc.setFontSize(18);
        doc.setTextColor(234, 88, 12);
        doc.text('Relatorio Financeiro - MCC', 14, 22);
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Gerado em: ${dateNow}`, 14, 30);
        doc.text(`Periodo: ${startDate || 'Inicio'} ate ${endDate || 'Hoje'}`, 14, 36);

        // --- Group & Sort by date ---
        const groupedData = filteredData.reduce((acc, curr) => {
            const date = curr.vencimento;
            if (!acc[date]) acc[date] = [];
            acc[date].push(curr);
            return acc;
        }, {});

        const sortedDates = Object.keys(groupedData).sort((a, b) => {
            const toISO = d => d.split('/').reverse().join('');
            return toISO(a).localeCompare(toISO(b));
        });

        // --- Top summary section ---
        const totalGeral = filteredData.reduce((acc, curr) => acc + curr.valor, 0);
        const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

        let yPos = 44;
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'bold');
        doc.text('Resumo Diario:', 14, yPos);
        doc.setFont('helvetica', 'normal');
        yPos += 6;

        doc.setFontSize(9);
        sortedDates.forEach(date => {
            const dayTotal = groupedData[date].reduce((s, it) => s + it.valor, 0);
            doc.text(`  ${date}:  ${fmt(dayTotal)}`, 18, yPos);
            yPos += 5.5;
            if (yPos > 272) { doc.addPage(); yPos = 20; }
        });

        yPos += 3;
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(`Total do Periodo: ${fmt(totalGeral)}`, 14, yPos);
        doc.setFont('helvetica', 'normal');
        yPos += 12;

        // Column widths: [Vencimento=22, Fornecedor/Desc=auto, Documento=25, Valor=30]
        const COL_STYLES = {
            0: { cellWidth: 22, halign: 'center' },
            1: { halign: 'left' },
            2: { cellWidth: 25, halign: 'center' },
            3: { cellWidth: 30, halign: 'right' }
        };

        sortedDates.forEach((date, idx) => {
            const dayRecords = groupedData[date];
            const dayTotal = dayRecords.reduce((s, it) => s + it.valor, 0);

            const tableRows = dayRecords.map(item => [
                safe(item.vencimento),
                safe(item.nome) + '\n' + safe(item.descricao || item.categoria || 'Sem descricao'),
                safe(item.documento || '-'),
                fmt(item.valor)
            ]);

            try {
                autoTable(doc, {
                    head: [
                        // Day header row spanning all columns
                        [{
                            content: `${date}   |   Total: ${fmt(dayTotal)}`,
                            colSpan: 4,
                            styles: {
                                fillColor: [234, 88, 12],
                                textColor: [255, 255, 255],
                                fontStyle: 'bold',
                                fontSize: 9,
                                halign: 'left',
                                cellPadding: { top: 4, bottom: 4, left: 6, right: 6 }
                            }
                        }],
                        // Column titles
                        ['Vencimento', 'Fornecedor / Descricao', 'Documento', 'Valor']
                    ],
                    body: tableRows,
                    startY: yPos,
                    theme: 'grid',
                    headStyles: {
                        fillColor: [245, 245, 245],
                        textColor: [50, 50, 50],
                        fontStyle: 'bold',
                        fontSize: 7.5
                    },
                    styles: {
                        fontSize: 8,
                        valign: 'middle',
                        cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
                        overflow: 'linebreak'
                    },
                    columnStyles: COL_STYLES,
                    margin: { left: 14, right: 14 },
                    didDrawPage: (data) => {
                        const str = 'Pagina ' + doc.internal.getNumberOfPages();
                        doc.setFontSize(7);
                        doc.setTextColor(150);
                        doc.text(str, data.settings.margin.left, doc.internal.pageSize.height - 8);
                    }
                });

                // Blank space between days (unless last one)
                yPos = doc.lastAutoTable.finalY + (idx < sortedDates.length - 1 ? 10 : 4);
            } catch (err) {
                console.error("Error in autoTable:", err);
            }
        });

        const fileName = `relatorio_mcc_${startDate || 'geral'}_a_${endDate || 'hoje'}.pdf`;
        doc.save(fileName);
    };


    // --- DDA IMPORT LOGIC ---
    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsProcessingFile(true);
        const reader = new FileReader();

        reader.onload = (event) => {
            const text = event.target.result;
            processDDAText(text);
        };

        reader.readAsText(file);
        e.target.value = null; // Reset input
    };

    const processDDAText = (text) => {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');

        if (lines.length < 6) {
            setIsProcessingFile(false);
            alert('Formato de arquivo inválido. O arquivo DDA deve ter dados a partir da linha 6.');
            return;
        }

        const importedRecords = [];

        // Data starts from index 5 (6th line). 
        for (let i = 5; i < lines.length; i++) {
            const values = lines[i].split(';');

            // Expected columns based on requirements:
            // A (0): Vencimento
            // B (1): Beneficiário
            // E (4): Valor
            let vencimento = values[0] ? values[0].trim() : '';
            let nome = values[1] ? values[1].trim().toUpperCase() : '';
            let valorStr = values[4] ? values[4].trim() : '';

            // Ignore the "Total" line at the bottom
            if (!vencimento || vencimento.toLowerCase().includes('total')) continue;

            const data_iso = parseDateString(vencimento);
            if (!data_iso) continue; // Skip invalid dates

            const valor = parseCurrency(valorStr);
            if (valor <= 0) continue; // Skip zero or invalid values

            // Generate a unique transient ID for UI tracking
            const tempId = 'id_' + i + '_' + Date.now();

            importedRecords.push({
                _id: tempId,
                vencimento,
                nome: nome || 'FORNECEDOR DDA NÃO IDENTIF.',
                descricao: 'BOLETO DDA IMPORTADO',
                observacao: 'IMPORTADO AUTOMATICAMENTE (DDA)',
                valor,
                data_iso,
                action: 'pending', // 'pending', 'insert', 'ignore', 'edit'
            });
        }

        // Filter out those present in global ignore list
        const filteredRecords = importedRecords.filter(r => !ddaIgnoredSuppliers.includes(r.nome));
        compareDDAWithBase(filteredRecords);
    };

    const compareDDAWithBase = (importedRecords) => {
        let newRecords = [];
        let divergentRecords = [];
        let exactRecords = [];

        importedRecords.forEach(record => {
            let matchType = 'new';
            let bestBaseMatch = null;

            for (const baseItem of baseData) {
                const isSameName = (baseItem.nome || '').toLowerCase() === (record.nome).toLowerCase();
                const isExactDate = baseItem.data_iso === record.data_iso;
                const valueDiff = Math.abs(baseItem.valor - record.valor);
                const isExactValue = valueDiff < 0.01;

                // Exact match logic
                if (isSameName && isExactDate && isExactValue) {
                    matchType = 'exact';
                    bestBaseMatch = baseItem;
                    break;
                }

                // Divergence logic: value diff <= 5 AND date diff <= 3 days
                if (valueDiff <= 5) {
                    const baseDateObj = new Date(baseItem.data_iso);
                    const recDateObj = new Date(record.data_iso);
                    const diffTime = Math.abs(recDateObj - baseDateObj);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays <= 3) {
                        if (matchType !== 'exact') {
                            matchType = 'divergent';
                            bestBaseMatch = baseItem; // keep the reference to show difference
                        }
                    }
                }
            }

            if (matchType === 'exact') {
                record.baseMatch = bestBaseMatch;
                exactRecords.push(record);
            } else if (matchType === 'divergent') {
                record.baseMatch = bestBaseMatch;
                divergentRecords.push(record);
            } else {
                newRecords.push(record);
            }
        });

        setDdaPreview({ newRecords, divergentRecords, exactRecords });
        setIsProcessingFile(false);
    };

    const handleDDAAction = (id, actionType, sourceList) => {
        setDdaPreview(prev => {
            const newState = { ...prev };

            // Special case: moving divergent to new
            if (actionType === 'unlink' && sourceList === 'divergentRecords') {
                const list = [...newState.divergentRecords];
                const index = list.findIndex(r => r._id === id);
                if (index !== -1) {
                    const [item] = list.splice(index, 1);
                    item.action = 'pending';
                    item.baseMatch = null;
                    newState.divergentRecords = list;
                    newState.newRecords = [...newState.newRecords, item];
                }
                return newState;
            }

            const list = [...newState[sourceList]];
            const index = list.findIndex(r => r._id === id);
            if (index !== -1) {
                if (actionType === 'delete') {
                    list.splice(index, 1);
                } else {
                    list[index] = { ...list[index], action: actionType };
                }
                newState[sourceList] = list;
            }
            return newState;
        });
    };

    const handleIgnoreSupplier = (nome) => {
        if (!window.confirm(`Tem certeza que deseja ignorar permanentemente todos os lançamentos DDA futuros do fornecedor "${nome}"?`)) return;

        setDdaIgnoredSuppliers(prev => [...prev, nome]);

        // Remove immediately from current view
        setDdaPreview(prev => {
            return {
                newRecords: prev.newRecords.filter(r => r.nome !== nome),
                divergentRecords: prev.divergentRecords.filter(r => r.nome !== nome),
                exactRecords: prev.exactRecords.filter(r => r.nome !== nome),
            };
        });
    };

    const saveToBackend = async () => {
        if (!ddaPreview) return;

        // Filter those explicitely meant to be inserted
        const toInsert = [
            ...ddaPreview.newRecords.filter(r => r.action === 'insert'),
            ...ddaPreview.divergentRecords.filter(r => r.action === 'insert') // Or update, based on logic
        ];

        if (toInsert.length === 0) return alert('Nenhum lançamento foi selecionado para Inserir.');

        setIsSavingInProgress(true);

        try {
            const payload = toInsert.map(r => ({
                vencimento: r.vencimento,
                nome: r.nome,
                descricao: r.descricao,
                valor: r.valor,
                observacao: r.observacao
            }));

            // Actual save operation to Supabase
            const { error } = await supabase
                .from('payments')
                .insert(payload);
            if (error) throw error;

            alert(`${toInsert.length} lançamentos importados com sucesso!\n\nEles já constam no Dashboard Geral vinculados ao banco de dados.`);
            setDdaPreview(null);
            // fetchPayments() will be called automatically by Realtime subscription
            setActiveTab('dashboard'); // Redirect to general list to view changes
        } catch (err) {
            console.error(err);
            alert('Erro ao salvar no banco de dados: ' + (err.message || 'Verifique o console.'));
        } finally {
            setIsSavingInProgress(false);
        }
    };

    // --- NEW: General Spreadsheet Import Logic ---
    const handleGeneralCsvImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target.result;
            const lines = text.split('\n');
            
            // Logic based on CSV format: skip 3 lines, 4th is header, skip last
            if (lines.length < 5) {
                alert('Arquivo CSV parece curto demais ou inválido.');
                return;
            }

            const headerLine = lines[3]; // Line 4 (index 3)
            const headers = headerLine.split(';').map(h => h.trim().toLowerCase());
            
            // Map column indices
            const colIdx = {
                data_movimento: headers.indexOf('data movim.'),
                documento: headers.indexOf('documento'),
                descricao: headers.indexOf('histórico'),
                nome: headers.indexOf('pessoa'),
                valor: headers.indexOf('valor'),
                vencimento: headers.indexOf('vencimento'),
                observacao: headers.indexOf('observação')
            };

            const dataRows = lines.slice(4, -1); // Skip 4 lines and last line (totals)
            const newRecords = dataRows
                .map(line => {
                    const cells = line.split(';');
                    if (cells.length < 5) return null;
                    return {
                        data_movimento: cells[colIdx.data_movimento] || '',
                        documento: cells[colIdx.documento] || '',
                        descricao: cells[colIdx.descricao] || '',
                        nome: cells[colIdx.nome] || '',
                        valor: parseCurrency(cells[colIdx.valor]),
                        vencimento: cells[colIdx.vencimento] || '',
                        observacao: cells[colIdx.observacao] || '',
                        source: 'native'
                    };
                })
                .filter(r => r && r.vencimento && r.nome);

            if (window.confirm(`Isso irá APAGAR TODOS os dados atuais (${dbData.length} registros) e importar ${newRecords.length} registros da planilha. Deseja continuar?`)) {
                setIsReseting(true);
                try {
                    // 1. Delete all records
                    const { error: delError } = await supabase.from('payments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                    if (delError) throw delError;

                    // 2. Insert new records in batches
                    const batchSize = 500;
                    for (let i = 0; i < newRecords.length; i += batchSize) {
                        const batch = newRecords.slice(i, i + batchSize);
                        const { error: insError } = await supabase.from('payments').insert(batch);
                        if (insError) throw insError;
                    }

                    alert(`Banco de dados resetado e ${newRecords.length} registros importados com sucesso!`);
                    fetchPayments();
                    setActiveTab('dashboard');
                } catch (err) {
                    console.error(err);
                    alert('Erro ao resetar banco: ' + err.message);
                } finally {
                    setIsReseting(false);
                }
            }
        };
        reader.readAsText(file, 'ISO-8859-1'); // Common for BR CSVs
    };

    // Safely expose functions to window for testing
    useEffect(() => {
        window.__test_processDDAText = processDDAText;
        window.__test_saveToBackend = saveToBackend;
    }, [processDDAText, saveToBackend]);

    if (!user) {
        return <Login onLogin={setUser} />;
    }

    return (
        <div className={`container ${!isDarkMode ? 'light-theme' : ''}`}>
             <header className="app-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ background: 'var(--color-accent-subtle)', padding: '0.5rem', borderRadius: '8px', color: 'var(--color-accent)' }}>
                        <Users size={32} />
                    </div>
                    <div>
                        <h1>Painel Financeiro - MCC</h1>
                        <p className="text-muted">Olá, {user.email} | <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: 0, textDecoration: 'underline', fontSize: '0.8rem' }}>Sair</button></p>
                    </div>
                </div>
                <button
                    onClick={() => setIsDarkMode(!isDarkMode)}
                    className="card"
                    style={{
                        padding: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        background: 'var(--color-bg-elevated)',
                        transition: 'all 0.2s ease',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-accent)'
                    }}
                    title={isDarkMode ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
                >
                    {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                </button>
            </header>

            {/* Navigation Tabs */}
            <nav className="nav-tabs">
                <button
                    className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
                    onClick={() => setActiveTab('dashboard')}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    <LayoutDashboard size={18} />
                    Dashboard Diário
                </button>
                <button
                    className={`nav-tab ${activeTab === 'reports' ? 'active' : ''}`}
                    onClick={() => setActiveTab('reports')}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    <FileBarChart size={18} />
                    Relatórios
                </button>
                <button
                    className={`nav-tab ${activeTab === 'audit' ? 'active' : ''}`}
                    onClick={() => setActiveTab('audit')}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    <History size={18} />
                    Histórico
                </button>
                <button
                    className={`nav-tab ${activeTab === 'import' ? 'active' : ''}`}
                    onClick={() => setActiveTab('import')}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', color: 'var(--color-accent)' }}
                >
                    <UploadCloud size={18} />
                    Importação
                </button>
            </nav>

            {/* Global Filters Section (Applies to dashboard/reports) */}
            {activeTab !== 'import' && (
                <div className="card" style={{ marginBottom: '2rem' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <FilterX size={18} className="stat-icon" /> Filtros de Consulta
                    </h3>
                    <div className="filters-bar">
                        <div className="inputs-row">
                            <div className="input-group">
                                <label>Descrição / Fornecedor</label>
                                <div className="input-icon-wrapper">
                                    <Search size={18} />
                                    <input
                                        type="text"
                                        className="input-with-icon"
                                        placeholder="Busque por nota, material, nome..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="input-group">
                                <label>Fornecedor</label>
                                <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
                                    <option value="">Todos os Fornecedores</option>
                                    {uniqueSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>

                            <div className="input-group">
                                <label>Início de Dados</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                />
                            </div>

                            <div className="input-group">
                                <label>Data Fim</label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>

                            {(searchTerm || supplierFilter || startDate || endDate || showOverdueOnly) && (
                                <button
                                    onClick={() => { clearFilters(); setShowOverdueOnly(false); }}
                                    className="action-btn"
                                    style={{
                                        background: 'var(--color-bg-elevated)',
                                        color: 'var(--color-text-muted)',
                                        border: '1px solid var(--color-border)',
                                        padding: '0.625rem 1.25rem'
                                    }}
                                    title="Limpar Filtros"
                                >
                                    Limpar
                                </button>
                            )}
                        </div>

                        <div className="actions-row">
                            <button
                                onClick={setSaturdayToFridayWeek}
                                className="action-btn"
                                style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-base)', border: '1px solid var(--color-border)' }}
                            >
                                <CalendarDays size={18} /> Semana (Sáb - Sexta)
                            </button>

                            <button
                                onClick={exportToPDF}
                                className="action-btn"
                                disabled={filteredData.length === 0}
                            >
                                <Download size={18} /> Exportar PDF
                            </button>

                            <button
                                onClick={() => setShowOverdueOnly(!showOverdueOnly)}
                                className="action-btn"
                                style={{
                                    background: showOverdueOnly ? 'var(--color-danger)' : 'var(--color-bg-elevated)',
                                    color: showOverdueOnly ? 'white' : 'var(--color-text-base)',
                                    border: `1px solid ${showOverdueOnly ? 'var(--color-danger)' : 'var(--color-border)'}`,
                                    fontWeight: showOverdueOnly ? '700' : '600'
                                }}
                            >
                                <AlertTriangle size={18} />
                                {showOverdueOnly ? 'Inadimplência Ativa' : 'Ver Atrasados'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Area based on Tab */}
            {activeTab === 'dashboard' && (
                <>
                    {/* Overdue Analysis Header (Only visible when active) */}
                    {showOverdueOnly && (
                        <div className="card" style={{ marginBottom: '2rem', border: '1px solid hsla(0, 84%, 60%, 0.3)', background: 'linear-gradient(to right, hsla(0, 84%, 60%, 0.05), transparent)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                                <div style={{ padding: '0.75rem', background: 'hsla(0, 84%, 60%, 0.2)', borderRadius: '12px', color: '#f87171' }}>
                                    <AlertTriangle size={24} />
                                </div>
                                <div>
                                    <h2 style={{ fontSize: '1.25rem', color: '#f87171', margin: 0 }}>Análise Crítica de Inadimplência</h2>
                                    <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: '0.875rem' }}>Visão focada apenas em obrigações com data de vencimento anterior a hoje.</p>
                                </div>
                            </div>

                            {stats.count > 0 ? (
                                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', background: 'transparent', gap: '1rem' }}>
                                    <div style={{ padding: '1rem', background: 'var(--color-bg-base)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>Montante em Atraso</div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f87171' }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.total)}</div>
                                    </div>
                                    <div style={{ padding: '1rem', background: 'var(--color-bg-base)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>Volume de Títulos</div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stats.count} faturas</div>
                                    </div>
                                    <div style={{ padding: '1rem', background: 'var(--color-bg-base)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> Vencimento mais Antigo</div>
                                        <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{stats.oldestOverdue ? stats.oldestOverdue.vencimento : '--'}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{stats.oldestOverdue ? stats.oldestOverdue.nome : ''}</div>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ padding: '1rem', background: 'var(--color-bg-base)', borderRadius: '8px', border: '1px solid var(--color-border)', color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <CheckCircle2 size={18} /> Excelente! Nenhuma fatura em atraso neste período.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Stats Summary Grid */}
                    <div className="grid">
                        <div className="card">
                            <div className="stat-header">
                                <TrendingUp size={18} className="stat-icon" style={{ color: 'var(--color-danger)' }} />
                                <div className="stat-label">Total Filtrado</div>
                            </div>
                            <div className="stat-value highlight">
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.total)}
                            </div>
                        </div>

                        <div className="card">
                            <div className="stat-header">
                                <CalendarDays size={18} className="stat-icon" style={{ color: 'var(--color-accent)' }} />
                                <div className="stat-label">Obrigações</div>
                            </div>
                            <div className="stat-value">{stats.count}</div>
                        </div>

                        <div className="card">
                            <div className="stat-header">
                                <Users size={18} className="stat-icon" style={{ color: '#8b5cf6' }} />
                                <div className="stat-label">Credores</div>
                            </div>
                            <div className="stat-value">{stats.suppliersCount}</div>
                        </div>
                    </div>

                    {/* Records Table */}
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Vencimento</th>
                                    <th>Documento</th>
                                    <th>Fornecedor</th>
                                    <th>Descrição</th>
                                    <th className="th-right">Valor</th>
                                    <th>Observações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredData.map((item, idx) => (
                                    <tr key={idx}>
                                        <td className="date-cell">
                                            {item.vencimento}
                                            {item.source === 'dda' && <span className="badge badge-dda">Via DDA</span>}
                                        </td>
                                        <td style={{ fontWeight: 600, color: 'var(--color-text-base)' }}>{item.documento || '--'}</td>
                                        <td>{item.nome}</td>
                                        <td style={{ fontSize: '0.875rem' }}>{item.descricao}</td>
                                        <td className="value-cell">{item.valor_fmt}</td>
                                        <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{item.observacao}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {filteredData.length === 0 && (
                            <div className="empty-state">
                                <Search size={48} style={{ opacity: 0.2 }} />
                                <p>Nenhuma fatura encontrada neste período com os filtros aplicados.</p>
                            </div>
                        )}
                    </div>
                </>
            )}

            {activeTab === 'reports' && (
                <div className="grid" style={{ gridTemplateColumns: '1fr' }}>

                    <div className="card" style={{ paddingBottom: '3rem' }}>
                        <h3 style={{ marginBottom: '1.5rem', color: 'var(--color-text-base)', fontSize: '1.25rem' }}>
                            Projeção de Pagamentos Diários
                        </h3>
                        {stats.dailyChartData.length > 0 ? (
                            <div style={{ height: '250px', width: '100%' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={stats.dailyChartData} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-grid)" />
                                        <XAxis
                                            dataKey="date"
                                            tick={{ fill: chartTextColor, fontSize: 12 }}
                                            axisLine={false}
                                            tickLine={false}
                                            dy={10}
                                        />
                                        <YAxis
                                            tick={{ fill: chartTextColor, fontSize: 12 }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={(val) => `R$ ${(val / 1000).toFixed(0)}k`}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: 'var(--color-tooltip)',
                                                border: `1px solid var(--color-border)`,
                                                borderRadius: 'var(--radius-md)',
                                                color: 'var(--color-text-base)',
                                                boxShadow: 'var(--shadow-lg)'
                                            }}
                                            formatter={(value) => [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value), 'Total do Dia']}
                                            labelFormatter={(label, payload) => payload?.[0]?.payload?.fullDate || label}
                                            itemStyle={{ color: 'var(--color-accent)' }}
                                        />
                                        <Line type="monotone" dataKey="value" stroke="var(--color-accent)" strokeWidth={3} dot={{ r: 4, fill: 'var(--color-bg-surface)', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="empty-state">Limpem os filtros para visualizar a projeção visual.</div>
                        )}
                    </div>

                    {/* Top Suppliers Chart */}
                    <div className="card">
                        <h3 style={{ marginBottom: '1.5rem', color: 'var(--color-text-base)', fontSize: '1.25rem' }}>
                            Concentração de Custos (Top 20 Fornecedores)
                        </h3>
                        {stats.topSuppliersChartData.length > 0 ? (
                            <div style={{ height: '800px', width: '100%' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={stats.topSuppliersChartData} layout="vertical" margin={{ left: 50 }}>
                                        <XAxis type="number" hide />
                                        <YAxis dataKey="name" type="category" tick={{ fill: chartTextColor, fontSize: 12 }} axisLine={false} tickLine={false} width={150} />
                                        <Tooltip
                                            cursor={{ fill: 'var(--color-accent-subtle)' }}
                                            contentStyle={{
                                                backgroundColor: 'var(--color-tooltip)',
                                                border: `1px solid var(--color-border)`,
                                                borderRadius: 'var(--radius-md)',
                                                color: 'var(--color-text-base)',
                                                boxShadow: 'var(--shadow-lg)'
                                            }}
                                            formatter={(value) => [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value), 'Total']}
                                            itemStyle={{ color: 'var(--color-accent)' }}
                                        />
                                        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={40}>
                                            {stats.topSuppliersChartData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="empty-state">Sem dados suficientes para consolidação.</div>
                        )}
                    </div>

                </div>
            )}

            {/* DDA Import Tab */}
            {activeTab === 'audit' && (
                <AuditHistory />
            )}

            {activeTab === 'import' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {/* General Spreadsheet Import */}
                    <div className="card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                            <div style={{ background: 'var(--color-primary-subtle)', padding: '0.5rem', borderRadius: '8px', color: 'var(--color-primary)' }}>
                                <UploadCloud size={24} />
                            </div>
                            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Importar Planilha Geral (Reset)</h2>
                        </div>
                        
                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                            Use esta opção para atualizar toda a base de dados a partir de uma exportação do seu sistema. 
                            <strong style={{ color: 'var(--color-danger)' }}> Atenção: Isso apaga todos os registros atuais!</strong>
                        </p>

                        <div style={{ background: 'rgba(0,0,0,0.1)', border: '1px dashed var(--color-border)', borderRadius: '12px', padding: '2rem', textAlign: 'center' }}>
                            <input
                                type="file"
                                id="general-csv-upload"
                                accept=".csv"
                                onChange={handleGeneralCsvImport}
                                style={{ display: 'none' }}
                                disabled={isReseting}
                            />
                            <label htmlFor="general-csv-upload" style={{ cursor: isReseting ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--color-bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)' }}>
                                    {isReseting ? <Loader2 className="animate-spin" /> : <FileBarChart size={24} />}
                                </div>
                                <div>
                                    <span style={{ fontWeight: 600, display: 'block' }}>{isReseting ? 'Sincronizando Banco de Dados...' : 'Clique para selecionar o CSV Geral'}</span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Formatos suportados: .csv (Exportação Padrão System)</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* DDA Import (Original) */}
                    <div className="card">
                    <h2 style={{ marginBottom: '1rem' }}>Sincronização DDA</h2>
                    <p className="text-muted" style={{ marginBottom: '2rem' }}>
                        Faça o upload do relatório extraído do banco (arquivo CSV). Iremos comparar com a base do sistema para evitar pagamentos duplicados.
                    </p>

                    {!ddaPreview ? (
                        <label className="dropzone">
                            <UploadCloud size={48} />
                            <div>
                                <h3 style={{ color: 'var(--color-text-base)' }}>Clique para anexar arquivo</h3>
                                <span className="text-muted">Apenas formato .csv (separado por ponto e vírgula)</span>
                            </div>
                            <input
                                type="file"
                                accept=".csv"
                                onChange={handleFileUpload}
                                style={{ display: 'none' }}
                                disabled={isProcessingFile}
                            />
                            {isProcessingFile && <div style={{ marginTop: '1rem' }}>Processando arquivo...</div>}
                        </label>
                    ) : (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <div>
                                    <h3 style={{ fontSize: '1.25rem' }}>Resultado da Análise</h3>
                                    <p className="text-muted">
                                        Novos/Pendentes: <strong style={{ color: 'var(--color-accent)' }}>{ddaPreview.newRecords.length + ddaPreview.divergentRecords.length}</strong> |
                                        Já Conciliados: <strong>{ddaPreview.exactRecords.length}</strong>
                                    </p>
                                </div>
                                <button
                                    className="action-btn"
                                    onClick={saveToBackend}
                                    disabled={isSavingInProgress}
                                >
                                    {isSavingInProgress ? 'Salvando...' : (
                                        <>
                                            <Save size={18} /> Salvar Lançamentos Selecionados
                                        </>
                                    )}
                                </button>
                            </div>

                            {ddaPreview.newRecords.length > 0 && (
                                <div className="card" style={{ marginBottom: '2rem' }}>
                                    <h4><AlertCircle size={16} /> Lançamentos Novos (Não Constam)</h4>
                                    <div className="table-container" style={{ marginTop: '1rem' }}>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Data</th>
                                                    <th>Fornecedor</th>
                                                    <th>Valor</th>
                                                    <th style={{ textAlign: 'right' }}>Ações</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ddaPreview.newRecords.map((r, i) => (
                                                    <tr key={`new-${i}`} style={{ opacity: r.action === 'ignored' ? 0.4 : 1 }}>
                                                        <td className="date-cell">{r.vencimento}</td>
                                                        <td>{r.nome}</td>
                                                        <td className="value-cell">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor)}</td>
                                                        <td style={{ textAlign: 'right' }}>
                                                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                                {r.action !== 'insert' ? (
                                                                    <button onClick={() => handleDDAAction(r._id, 'insert', 'newRecords')} style={{ background: 'var(--color-accent)', color: 'white', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Inserir</button>
                                                                ) : (
                                                                    <button onClick={() => handleDDAAction(r._id, 'pending', 'newRecords')} style={{ background: 'var(--color-success)', color: 'white', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}><CheckCircle2 size={12} /> Confirmado</button>
                                                                )}
                                                                <button onClick={() => handleDDAAction(r._id, 'delete', 'newRecords')} style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Ignorar Boleto</button>
                                                                <button onClick={() => handleIgnoreSupplier(r.nome)} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--color-danger)', color: 'white', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }} title={`Ignorar permanentemente fornecedor: ${r.nome}`}><FilterX size={12} /> Ignorar Sempre</button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {ddaPreview.divergentRecords.length > 0 && (
                                <div className="card" style={{ marginBottom: '2rem', border: '1px solid var(--color-warning)' }}>
                                    <h4><AlertTriangle size={16} color="var(--color-warning)" /> Divergências Encontradas</h4>
                                    <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>Valores ou datas próximos, mas com diferenças em relação ao banco de dados.</p>
                                    <div className="table-container">
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Detalhes DDA</th>
                                                    <th>Detalhes Banco de Dados</th>
                                                    <th style={{ textAlign: 'right' }}>Ações</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ddaPreview.divergentRecords.map((r, i) => (
                                                    <tr key={`div-${i}`}>
                                                        <td>
                                                            <strong style={{ display: 'block' }}>{r.vencimento} - {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor)}</strong>
                                                            <span style={{ fontSize: '0.85em', color: 'var(--color-text-muted)' }}>{r.nome}</span>
                                                        </td>
                                                        <td style={{ opacity: 0.7 }}>
                                                            <strong style={{ display: 'block' }}>{parseDateString(r.baseMatch.vencimento).split('-').reverse().join('/')} - {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.baseMatch.valor)}</strong>
                                                            <span style={{ fontSize: '0.85em' }}>{r.baseMatch.nome}</span>
                                                        </td>
                                                        <td style={{ textAlign: 'right' }}>
                                                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                                {r.action !== 'insert' ? (
                                                                    <button onClick={() => handleDDAAction(r._id, 'insert', 'divergentRecords')} style={{ background: 'var(--color-warning)', color: 'black', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Substituir (Aceitar DDA)</button>
                                                                ) : (
                                                                    <button onClick={() => handleDDAAction(r._id, 'pending', 'divergentRecords')} style={{ background: 'var(--color-success)', color: 'white', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}><CheckCircle2 size={12} /> Substituído</button>
                                                                )}
                                                                <button onClick={() => handleDDAAction(r._id, 'unlink', 'divergentRecords')} style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }} title="Remover vinculo e tratar como Novo DDA">Não é este boleto (Desvincular)</button>
                                                                <button onClick={() => handleDDAAction(r._id, 'delete', 'divergentRecords')} style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-danger)', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Ignorar Boleto</button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {ddaPreview.exactRecords.length > 0 && (
                                <div className="card" style={{ opacity: 0.7 }}>
                                    <h4><CheckCircle2 size={16} color="var(--color-success)" /> Já Conciliados</h4>
                                    <div className="table-container" style={{ marginTop: '1rem' }}>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Data</th>
                                                    <th>Fornecedor</th>
                                                    <th>Valor</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ddaPreview.exactRecords.map((r, i) => (
                                                    <tr key={`exact-${i}`}>
                                                        <td className="date-cell">{r.vencimento}</td>
                                                        <td>{r.nome}</td>
                                                        <td className="value-cell">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                                <button
                                    onClick={() => setDdaPreview(null)}
                                    style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}
                                >
                                    Carregar Outro Arquivo DDA
                                </button>
                            </div>
                        </div>
                    )}
                    </div>
                </div>
            )}


        </div>
    );
};

export default App;
// Force Vite HMR Cache Clear 2
