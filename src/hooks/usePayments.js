import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { parseDateString, formatCurrency } from '../lib/utils';

/**
 * Hook para gerenciar o estado e as operações de pagamentos via Supabase.
 * Encapsula: busca inicial, subscription em tempo real, e dados derivados (baseData).
 *
 * @returns {{
 *   dbData: Array,
 *   localDdaData: Array,
 *   setLocalDdaData: Function,
 *   baseData: Array,
 *   isLoading: boolean,
 *   fetchPayments: Function,
 * }}
 */
export const usePayments = () => {
    const [dbData, setDbData] = useState([]);
    const [localDdaData, setLocalDdaData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchPayments = useCallback(async () => {
        setIsLoading(true);
        const { data, error } = await supabase
            .from('payments')
            .select('*')
            .order('vencimento', { ascending: true });

        if (error) {
            console.error('Erro ao buscar pagamentos:', error);
        } else {
            const mapped = (data || []).map(item => ({
                ...item,
                valor: parseFloat(item.valor),
            }));
            setDbData(mapped);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        fetchPayments();

        const channel = supabase
            .channel('public:payments')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
                fetchPayments();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchPayments]);

    // Combina dados do banco e DDA local, enriquecendo com campos derivados
    const baseData = (() => {
        const mappedDb = dbData.map(d => ({ ...d, source: d.source || 'native' }));
        const mappedLocalDda = localDdaData.map(d => ({ ...d, source: 'dda' }));
        const combined = [...mappedDb, ...mappedLocalDda];

        return combined
            .map(item => ({
                ...item,
                data_iso: parseDateString(item.vencimento),
                valor_fmt: formatCurrency(item.valor),
            }))
            .sort((a, b) => (a.data_iso || '').localeCompare(b.data_iso || ''));
    })();

    return {
        dbData,
        localDdaData,
        setLocalDdaData,
        baseData,
        isLoading,
        fetchPayments,
    };
};
