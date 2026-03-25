import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Login from './components/Login';
import AuditHistory from './components/AuditHistory';
import RenegotiationPlanner from './components/RenegotiationPlanner';
import ImportacaoGeral from './components/ImportacaoGeral';
import ImportacaoDDA from './components/ImportacaoDDA';
import ImportacaoExtras from './components/ImportacaoExtras';
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
    CheckCircle,
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
    History,
    Loader2,
    Database,
    CreditCard,
    Handshake,
    Trash2
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

const identifyCard = (doc) => {
    if (!doc) return null;
    const s = String(doc).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    if (s.includes('caixa black mauro') || s.includes('cx black mauro')) return 'CX_BLACK_MAURO';
    if (s.includes('elo nanquim mauro')) return 'ELO_NANQUIM_MAURO';
    if (s.includes('caixa black junior') || s.includes('caixa black jr') || s.includes('cx black junior') || s.includes('cx black jr')) return 'CX_BLACK_JR';
    if (s.includes('elo nanquim junior') || s.includes('elo nanquim jr')) return 'ELO_NANQUIM_JR';
    
    return null;
};

const App = () => {
    const [user, setUser] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [activeTab, setActiveTab] = useState('dashboard');
    const [searchTerm, setSearchTerm] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('');

    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [showOverdueOnly, setShowOverdueOnly] = useState(false);
    const [classFilter, setClassFilter] = useState('');
    const [cardFilter, setCardFilter] = useState('');


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

            const classMatches = classFilter === '' || 
                (classFilter === 'URGENTE' ? (item.classificacao === 'URGENTE' || item.classificacao === 'URGENTES') : item.classificacao === classFilter);

            const cardType = identifyCard(item.documento);
            const cardMatches = cardFilter === '' || cardType === cardFilter;

            return textMatches && supplierMatches && afterStart && beforeEnd && isOverdue && classMatches && cardMatches;
        });
    }, [baseData, searchTerm, supplierFilter, startDate, endDate, showOverdueOnly, activeTab, classFilter, cardFilter]);

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

    const bestDaysToPay = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const twoMonthsLater = new Date(today.getFullYear(), today.getMonth() + 3, 0);

        const dailyTotals = {};

        // Pre-fill all working days with 0
        let currDate = new Date(today);
        while (currDate <= twoMonthsLater) {
            const dayOfWeek = currDate.getDay();
            // Ignorar sábados (6) e domingos (0)
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                const dateStr = currDate.toISOString().split('T')[0];
                dailyTotals[dateStr] = 0;
            }
            currDate.setDate(currDate.getDate() + 1);
        }

        baseData.forEach(item => {
            if (!item.data_iso) return;
            // Use local date parsing equivalent to how we initialized
            const dIsoKey = item.data_iso.substring(0, 10);
            if (dailyTotals[dIsoKey] !== undefined) {
                dailyTotals[dIsoKey] += (item.valor || 0);
            }
        });

        const sortedDays = Object.keys(dailyTotals)
            .map(date => ({ date, total: dailyTotals[date] }))
            .sort((a, b) => a.total - b.total); // Sort lowest first

        // Para evitar sugerir dias seguidos (ex: 12, 13, 14), vamos pegar dias com gap de 3 dias
        const result = [];
        for (const day of sortedDays) {
            const dFormat = new Date(day.date + 'T00:00:00');
            const hasConflict = result.some(resDay => {
                const rFormat = new Date(resDay.date + 'T00:00:00');
                const diffDays = Math.abs((dFormat - rFormat) / (1000 * 60 * 60 * 24));
                return diffDays < 3;
            });
            if (!hasConflict) {
                result.push(day);
            }
            if (result.length >= 3) break;
        }

        return result;
    }, [baseData]);

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
        setClassFilter('');
        setCardFilter('');
        setShowOverdueOnly(false);
    };

    // --- SELECTION & DELETE LOGIC ---
    const visibleSelectedItems = useMemo(() => {
        return filteredData.filter(item => selectedIds.has(item.id));
    }, [filteredData, selectedIds]);

    const selectedItemsSum = useMemo(() => {
        return visibleSelectedItems.reduce((acc, curr) => acc + curr.valor, 0);
    }, [visibleSelectedItems]);

    const isAllVisibleSelected = filteredData.length > 0 && 
                                 visibleSelectedItems.length === filteredData.length;

    const toggleSelectAll = () => {
        const newSet = new Set(selectedIds);
        if (isAllVisibleSelected) {
            filteredData.forEach(item => newSet.delete(item.id));
        } else {
            filteredData.forEach(item => newSet.add(item.id));
        }
        setSelectedIds(newSet);
    };

    const toggleSelection = (id) => {
        if (!id) return; // Prevent selection if element has no ID mapped yet
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const handleDeleteSelected = async () => {
        const idsToDelete = visibleSelectedItems.map(item => item.id).filter(id => id);
        if (idsToDelete.length === 0) return;
        
        if (!window.confirm(`Tem certeza que deseja excluir as ${idsToDelete.length} faturas selecionadas? (Essa ação é irreversível)`)) return;

        try {
            const { error } = await supabase.from('payments').delete().in('id', idsToDelete);
            if (error) throw error;
            
            const newSet = new Set(selectedIds);
            idsToDelete.forEach(id => newSet.delete(id));
            setSelectedIds(newSet);
            // Re-fetch handled generally by realtime subscription, but we can force:
            fetchPayments();
        } catch (error) {
            alert("Erro ao excluir faturas: " + error.message);
        }
    };

    // --- SAT-FRI WEEK LOGIC ---
    const handlePresetDateRange = useCallback((range) => {
        if (range === 'week') {
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
        }
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

    const exportBySupplierPDF = () => {
        const doc = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4',
            putOnlyUsedFonts: true,
            compress: true
        });
        
        const dateNow = new Date().toLocaleDateString('pt-BR');

        // --- Header ---
        doc.setFontSize(18);
        doc.setTextColor(234, 88, 12);
        doc.text('Relatorio Financeiro - Fornecedores', 14, 22);
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Gerado em: ${dateNow}`, 14, 30);
        doc.text(`Periodo: ${startDate || 'Inicio'} ate ${endDate || 'Hoje'}`, 14, 36);
        
        // Group data by supplier
        const groupedData = filteredData.reduce((acc, curr) => {
            const supplier = curr.nome || 'SEM FORNECEDOR';
            if (!acc[supplier]) acc[supplier] = [];
            acc[supplier].push(curr);
            return acc;
        }, {});

        const sortedSuppliers = Object.keys(groupedData).sort((a, b) => a.localeCompare(b));
        const totalGeral = filteredData.reduce((acc, curr) => acc + curr.valor, 0);
        const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

        let yPos = 46;

        // Page 1: Supplier Summary
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'bold');
        doc.text('Resumo Consolidado por Fornecedor', 14, yPos);
        yPos += 8;
        
        const summaryRows = sortedSuppliers.map(sup => {
            const supTotal = groupedData[sup].reduce((s, it) => s + it.valor, 0);
            return [sup, fmt(supTotal)];
        });
        
        autoTable(doc, {
            head: [['Fornecedor', 'Total']],
            body: summaryRows,
            startY: yPos,
            theme: 'grid',
            headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 },
            styles: { fontSize: 9, cellPadding: 3 }
        });

        // Add details pages
        doc.addPage();
        yPos = 20;

        sortedSuppliers.forEach((supplier, idx) => {
            const records = groupedData[supplier];
            const supTotal = records.reduce((s, it) => s + it.valor, 0);

            const tableRows = records.map(item => [
                item.vencimento || '-',
                (item.descricao || item.categoria || 'Sem descricao').substring(0, 40),
                item.documento || '-',
                fmt(item.valor)
            ]);

            try {
                autoTable(doc, {
                    head: [
                        [{
                            content: `${supplier} | Total: ${fmt(supTotal)}`,
                            colSpan: 4,
                            styles: {
                                fillColor: [30, 64, 175], // Darker Blue
                                textColor: [255, 255, 255],
                                fontStyle: 'bold',
                                fontSize: 10,
                                halign: 'left',
                                cellPadding: { top: 4, bottom: 4, left: 6, right: 6 }
                            }
                        }],
                        ['Vencimento', 'Descricao', 'Documento', 'Valor']
                    ],
                    body: tableRows,
                    startY: yPos,
                    theme: 'grid',
                    headStyles: {
                        fillColor: [240, 244, 255],
                        textColor: [50, 50, 50],
                        fontStyle: 'bold',
                        fontSize: 8
                    },
                    styles: {
                        fontSize: 8,
                        valign: 'middle',
                        cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
                        overflow: 'linebreak'
                    },
                    columnStyles: {
                        0: { cellWidth: 25, halign: 'center' },
                        1: { halign: 'left' },
                        2: { cellWidth: 35, halign: 'center' },
                        3: { cellWidth: 30, halign: 'right' }
                    },
                    margin: { left: 14, right: 14 }
                });
                yPos = doc.lastAutoTable.finalY + 10;
            } catch (err) {
                console.error("Error in autoTable:", err);
            }
        });

        const fileName = `relatorio_fornecedores_${startDate || 'geral'}_a_${endDate || 'hoje'}.pdf`;
        doc.save(fileName);
    };



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
                    className={`nav-tab ${activeTab === 'cards' ? 'active' : ''}`}
                    onClick={() => setActiveTab('cards')}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    <CreditCard size={18} />
                    Cartões
                </button>
                <button
                    className={`nav-tab ${activeTab === 'renegotiation' ? 'active' : ''}`}
                    onClick={() => setActiveTab('renegotiation')}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    <Handshake size={18} />
                    Renegociação IA
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
                        <div className="inputs-grid">
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
                                <label>Classificação</label>
                                <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                                    <option value="">Todas</option>
                                    <option value="COMPRAS">Compras</option>
                                    <option value="TERCEIROS">Terceiros</option>
                                    <option value="URGENTE">Urgente</option>
                                    <option value="OUTROS">Outros</option>
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

                            <div className="input-group">
                                <label>Cartão de Crédito</label>
                                <select value={cardFilter} onChange={(e) => setCardFilter(e.target.value)}>
                                    <option value="">Todos os Cartões</option>
                                    <option value="CX_BLACK_MAURO">Caixa Black Mauro</option>
                                    <option value="ELO_NANQUIM_MAURO">Elo Nanquim Mauro</option>
                                    <option value="CX_BLACK_JR">Caixa Black Jr</option>
                                    <option value="ELO_NANQUIM_JR">Elo Nanquim Jr</option>
                                </select>
                            </div>

                            {/* --- WIDGET MELHORES DIAS (INTEGRADO E SIMÉTRICO) --- */}
                            <div className="best-days-container">
                                <div className="best-days-header">
                                    <CheckCircle size={16} color="var(--color-success)" />
                                    <span>Sugestão: Melhores dias para novas dívidas</span>
                                </div>
                                <div className="best-days-grid">
                                    {bestDaysToPay.map((item, idx) => {
                                        const d = new Date(item.date + 'T00:00:00');
                                        const fmtDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
                                        return (
                                            <div key={idx} className="best-day-card">
                                                <span className="best-day-date">{fmtDate}</span>
                                                <span className="best-day-label">Sugerido</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginTop: '1rem' }}>
                            <div className="actions-row">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => handlePresetDateRange('week')}
                                >
                                    <CalendarDays size={16} />
                                    Semana (Sáb - Sexta)
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={exportToPDF}
                                >
                                    <Download size={16} />
                                    Exportar PDF
                                </button>
                                <button
                                    className="btn btn-warning"
                                    onClick={exportBySupplierPDF}
                                >
                                    <Download size={16} />
                                    PDF por Fornecedor
                                </button>

                                <button
                                    className="btn"
                                    onClick={() => setShowOverdueOnly(!showOverdueOnly)}
                                    style={{
                                        background: showOverdueOnly ? 'var(--color-danger)' : 'var(--color-bg-elevated)',
                                        color: showOverdueOnly ? 'white' : 'var(--color-text-base)',
                                        borderColor: showOverdueOnly ? 'var(--color-danger)' : 'var(--color-border)'
                                    }}
                                >
                                    <AlertTriangle size={16} />
                                    {showOverdueOnly ? 'Ver Todas' : 'Ver Atrasados'}
                                </button>
                            </div>
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

                    {/* Action Bar for Selection */}
                    {visibleSelectedItems.length > 0 && (
                        <div className="card" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-accent-subtle)', border: '1px solid var(--color-accent)', padding: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <CheckCircle2 size={24} color="var(--color-accent)" />
                                <div>
                                    <h3 style={{ margin: 0, color: 'var(--color-text-base)', fontSize: '1.1rem' }}>{visibleSelectedItems.length} {visibleSelectedItems.length === 1 ? 'item selecionado' : 'itens selecionados'}</h3>
                                    <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                                        Soma total: <strong style={{color: 'var(--color-accent)', fontSize: '1.1rem'}}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(selectedItemsSum)}</strong>
                                    </p>
                                </div>
                            </div>
                            
                            <button 
                                onClick={handleDeleteSelected}
                                className="action-btn hover-danger"
                                style={{ background: 'var(--color-danger)', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, padding: '0.75rem 1.5rem' }}
                            >
                                <Trash2 size={18} />
                                Excluir Selecionados
                            </button>
                        </div>
                    )}

                    {/* Records Table */}
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th style={{ width: '40px', textAlign: 'center' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={isAllVisibleSelected} 
                                            onChange={toggleSelectAll} 
                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                        />
                                    </th>
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
                                    <tr key={idx} style={{ backgroundColor: selectedIds.has(item.id) ? 'var(--color-accent-subtle)' : undefined, transition: 'background-color 0.2s ease' }}>
                                        <td style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => toggleSelection(item.id)}>
                                            <input 
                                                type="checkbox" 
                                                checked={selectedIds.has(item.id)}
                                                onChange={() => toggleSelection(item.id)}
                                                onClick={(e) => e.stopPropagation()}
                                                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                disabled={!item.id} // Prevents checking transient items if they have no id
                                            />
                                        </td>
                                        <td className="date-cell" onClick={() => toggleSelection(item.id)}>
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
                    <ImportacaoGeral onImportSuccess={() => {
                        fetchPayments();
                        setActiveTab('dashboard');
                    }} />
                    <ImportacaoDDA 
                        baseData={baseData} 
                        onImportSuccess={() => {
                            fetchPayments();
                            setActiveTab('dashboard');
                        }} 
                    />
                    <ImportacaoExtras 
                        onImportSuccess={() => {
                            fetchPayments();
                            setActiveTab('dashboard');
                        }} 
                    />
                </div>
            )}

            {/* --- CARDS TAB --- */}
            {activeTab === 'cards' && (() => {
                const CARD_CONFIG = [
                    { key: 'CX_BLACK_MAURO',    label: 'Caixa Black (Mauro)',   color: '#f97316' },
                    { key: 'ELO_NANQUIM_MAURO', label: 'Elo Nanquim (Mauro)',   color: '#3b82f6' },
                    { key: 'CX_BLACK_JR',       label: 'Caixa Black (Jr)',      color: '#8b5cf6' },
                    { key: 'ELO_NANQUIM_JR',    label: 'Elo Nanquim (Jr)',      color: '#10b981' },
                ];

                // Group transactions by card
                const cardGroups = { CX_BLACK_MAURO: [], ELO_NANQUIM_MAURO: [], CX_BLACK_JR: [], ELO_NANQUIM_JR: [] };
                filteredData.forEach(item => {
                    const card = identifyCard(item.documento);
                    if (card && cardGroups[card]) {
                        cardGroups[card].push(item);
                    }
                });

                const cardSums = {};
                CARD_CONFIG.forEach(c => {
                    cardSums[c.key] = cardGroups[c.key].reduce((acc, item) => acc + (item.valor || 0), 0);
                });

                const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
                const totalCards = Object.values(cardSums).reduce((a, b) => a + b, 0);
                const hasAnyTransaction = Object.values(cardGroups).some(g => g.length > 0);

                return (
                    <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                        {/* Summary Cards */}
                        <div className="stats-grid">
                            {CARD_CONFIG.map(cfg => (
                                <div key={cfg.key} className="card stat-card" style={{ borderLeft: `4px solid ${cfg.color}` }}>
                                    <div className="stat-header">
                                        <span className="stat-title" style={{ color: 'var(--color-text-base)' }}>{cfg.label}</span>
                                        <CreditCard size={18} color={cfg.color} />
                                    </div>
                                    <div className="stat-value" style={{ color: 'var(--color-text-base)' }}>{fmt(cardSums[cfg.key])}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                                        {cardGroups[cfg.key].length} transaç{cardGroups[cfg.key].length === 1 ? 'ão' : 'ões'}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Total consolidado */}
                        {hasAnyTransaction && (
                            <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', background: 'var(--color-accent-subtle)', border: '1px solid var(--color-accent)' }}>
                                <span style={{ fontWeight: 600, color: 'var(--color-text-base)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <CreditCard size={18} />
                                    Total Geral — Cartões de Crédito
                                </span>
                                <span style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--color-accent)' }}>{fmt(totalCards)}</span>
                            </div>
                        )}

                        {/* Transactions per card */}
                        {!hasAnyTransaction ? (
                            <div className="card">
                                <div className="empty-state">
                                    <CreditCard size={48} style={{ opacity: 0.2 }} />
                                    <p>Nenhuma transação de cartão encontrada no período filtrado.<br/>
                                    <span style={{ fontSize: '0.85rem' }}>Verifique o campo "Documento" nos registros — ele deve conter o nome do cartão (ex: "Caixa Black Mauro").</span>
                                    </p>
                                </div>
                            </div>
                        ) : (
                            CARD_CONFIG.map(cfg => {
                                const items = cardGroups[cfg.key];
                                if (items.length === 0) return null;
                                const groupTotal = cardSums[cfg.key];
                                return (
                                    <div key={cfg.key} className="card" style={{ borderTop: `3px solid ${cfg.color}` }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem', margin: 0 }}>
                                                <CreditCard size={20} color={cfg.color} />
                                                {cfg.label}
                                            </h3>
                                            <span style={{ fontWeight: 700, fontSize: '1rem', color: cfg.color }}>
                                                Total: {fmt(groupTotal)}
                                            </span>
                                        </div>
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
                                                    {items.map((item, idx) => (
                                                        <tr key={idx}>
                                                            <td className="date-cell">{item.vencimento}</td>
                                                            <td style={{ fontWeight: 600, color: 'var(--color-text-base)', fontSize: '0.8rem' }}>{item.documento || '--'}</td>
                                                            <td>{item.nome}</td>
                                                            <td style={{ fontSize: '0.875rem' }}>{item.descricao}</td>
                                                            <td className="value-cell">{item.valor_fmt}</td>
                                                            <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{item.observacao}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                <tfoot>
                                                    <tr style={{ fontWeight: 700, background: 'var(--color-bg-elevated)' }}>
                                                        <td colSpan={4} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                                                            Subtotal ({items.length} lançamento{items.length !== 1 ? 's' : ''})
                                                        </td>
                                                        <td className="value-cell" style={{ color: cfg.color }}>{fmt(groupTotal)}</td>
                                                        <td></td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                );
            })()}

            {/* --- CARDS TAB, RENEGOTIATION IA & IMPORT TAB ARE ABOVE --- */}
            {activeTab === 'renegotiation' && (
                <RenegotiationPlanner data={filteredData} allData={baseData} />
            )}

        </div>
    );
};

export default App;
// Force Vite HMR Cache Clear 2
