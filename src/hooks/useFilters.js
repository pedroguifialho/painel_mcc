import { useState, useMemo, useCallback } from 'react';
import { identifyCard } from '../lib/utils';

/**
 * Hook para gerenciar filtros da listagem de pagamentos.
 * Encapsula: estado dos filtros, lógica de filtragem, limpeza de filtros.
 *
 * @param {Array} baseData - Array de pagamentos base (já com data_iso)
 * @param {string} activeTab - Aba ativa atual
 * @returns {{
 *   searchTerm, setSearchTerm,
 *   supplierFilter, setSupplierFilter,
 *   startDate, setStartDate,
 *   endDate, setEndDate,
 *   showOverdueOnly, setShowOverdueOnly,
 *   classFilter, setClassFilter,
 *   cardFilter, setCardFilter,
 *   filteredData,
 *   uniqueSuppliers,
 *   clearFilters,
 * }}
 */
export const useFilters = (baseData, activeTab) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [showOverdueOnly, setShowOverdueOnly] = useState(false);
    const [classFilter, setClassFilter] = useState('');
    const [cardFilter, setCardFilter] = useState('');

    const filteredData = useMemo(() => {
        if (activeTab === 'import') return [];

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

            const classMatches =
                classFilter === '' ||
                (classFilter === 'URGENTE'
                    ? item.classificacao === 'URGENTE' || item.classificacao === 'URGENTES'
                    : item.classificacao === classFilter);

            const cardType = identifyCard(item.documento);
            const cardMatches = cardFilter === '' || cardType === cardFilter;

            return textMatches && supplierMatches && afterStart && beforeEnd && isOverdue && classMatches && cardMatches;
        });
    }, [baseData, searchTerm, supplierFilter, startDate, endDate, showOverdueOnly, activeTab, classFilter, cardFilter]);

    const uniqueSuppliers = useMemo(() => {
        return [...new Set(baseData.map(item => item.nome))].sort();
    }, [baseData]);

    const clearFilters = useCallback(() => {
        setSearchTerm('');
        setSupplierFilter('');
        setStartDate('');
        setEndDate('');
        setClassFilter('');
        setCardFilter('');
        setShowOverdueOnly(false);
    }, []);

    return {
        searchTerm, setSearchTerm,
        supplierFilter, setSupplierFilter,
        startDate, setStartDate,
        endDate, setEndDate,
        showOverdueOnly, setShowOverdueOnly,
        classFilter, setClassFilter,
        cardFilter, setCardFilter,
        filteredData,
        uniqueSuppliers,
        clearFilters,
    };
};
