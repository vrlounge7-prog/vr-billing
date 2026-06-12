const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { authenticateToken } = require('../middleware/auth');

router.get('/daily/:date', authenticateToken, async (req, res) => {
    try {
        const date = req.params.date;
        const includePast = req.query.include_past === 'true';

        const filters = { date: date, include_void: 'false' };
        if (includePast) filters.include_past = 'true';

        let transactions = await store.getTransactions(filters);
        transactions = transactions.filter(tx => tx.payment_status === 'completed');

        if (!includePast) {
            transactions = transactions.filter(tx => {
                return !tx.is_past || tx.transaction_date === date;
            });
        }

        const byMethod = {};
        const byHour = {};
        const byCashier = {};
        const byStation = {};

        transactions.forEach(tx => {
            const method = tx.payment_method || 'Unknown';
            if (!byMethod[method]) byMethod[method] = { count: 0, total: 0 };
            byMethod[method].count++;
            byMethod[method].total += tx.total_amount;

            const hour = tx.transaction_time ? tx.transaction_time.split(':')[0] : '00';
            const hourKey = `${hour}:00`;
            if (!byHour[hourKey]) byHour[hourKey] = { count: 0, total: 0 };
            byHour[hourKey].count++;
            byHour[hourKey].total += tx.total_amount;

            const name = tx.cashier_name || 'Unknown';
            if (!byCashier[name]) byCashier[name] = { count: 0, total: 0 };
            byCashier[name].count++;
            byCashier[name].total += tx.total_amount;

            const stn = tx.station_used || 'Unknown';
            if (!byStation[stn]) byStation[stn] = { count: 0, total: 0, cash: 0, mpesa: 0, credit: 0 };
            byStation[stn].count++;
            byStation[stn].total += tx.total_amount;
            if (tx.payment_method === 'Cash') byStation[stn].cash += tx.total_amount;
            else if (tx.payment_method === 'Mpesa') byStation[stn].mpesa += tx.total_amount;
            else if (tx.payment_method === 'Credit') byStation[stn].credit += tx.total_amount;
        });

        // Define game categories with their station name patterns
        // PAINTBALL is now ISOLATED - will have its own separate section
        const categoryDefinitions = {
            'POOL': {
                name: 'POOL TABLE',
                icon: '🎱',
                patterns: ['pool', 'billiard', '8 ball', '9 ball']
            },
            'VR': {
                name: 'VR EXPERIENCE',
                icon: '🥽',
                patterns: ['vr', 'virtual reality', 'oculus', 'quest', 'headset']
            },
            'PLAYSTATION': {
                name: 'PLAYSTATION (PS4/PS5)',
                icon: '🎮',
                patterns: ['ps5', 'ps4', 'playstation', 'play station', 'console']
            },
            'DARTS': {
                name: 'DARTS',
                icon: '🎯',
                patterns: ['dart', 'bullseye']
            },
            'FOOSBALL': {
                name: 'FOOSBALL',
                icon: '⚽',
                patterns: ['foosball', 'foos ball', 'table football', 'foos']
            },
            'RACE SIMULATOR': {
                name: 'RACE SIMULATOR',
                icon: '🏎️',
                patterns: ['race', 'racing', 'simulator', 'sim racing', 'wheel']
            },
            'PAINTBALL': {
                name: 'PAINTBALL (ISOLATED)',
                icon: '🔫',
                patterns: ['paintball', 'paint ball', 'paint'],
                isolated: true  // Flag to indicate this category is isolated
            }
        };

        // Initialize categories
        const byStationType = {};
        for (const [categoryKey, categoryData] of Object.entries(categoryDefinitions)) {
            byStationType[categoryKey] = {
                name: categoryData.name,
                icon: categoryData.icon,
                cash: 0,
                mpesa: 0,
                credit: 0,
                total: 0,
                count: 0,
                isolated: categoryData.isolated || false
            };
        }

        // Track unmatched stations for debugging
        const unmatchedStations = new Set();
        // Track if we found any paintball transactions
        let paintballFound = false;

        for (const [stationName, stationData] of Object.entries(byStation)) {
            let matched = false;
            const stationLower = stationName.toLowerCase().trim();

            for (const [categoryKey, categoryDef] of Object.entries(categoryDefinitions)) {
                const isMatch = categoryDef.patterns.some(pattern =>
                    stationLower.includes(pattern)
                );

                if (isMatch) {
                    // Add to the matched category
                    byStationType[categoryKey].cash += stationData.cash || 0;
                    byStationType[categoryKey].mpesa += stationData.mpesa || 0;
                    byStationType[categoryKey].credit += stationData.credit || 0;
                    byStationType[categoryKey].total += stationData.total || 0;
                    byStationType[categoryKey].count += stationData.count || 0;
                    matched = true;

                    // Track if paintball was found
                    if (categoryKey === 'PAINTBALL') {
                        paintballFound = true;
                    }
                    break;
                }
            }

            if (!matched && stationName !== 'Unknown' && stationName !== 'Manual Entry') {
                unmatchedStations.add(stationName);
            }
        }

        // Log unmatched stations for debugging
        if (unmatchedStations.size > 0) {
            console.log('⚠️ UNMATCHED STATIONS - Need to update patterns:');
            unmatchedStations.forEach(station => {
                console.log(`  - "${station}"`);
            });
        }

        // Remove empty non-paintball categories (keep paintball even if empty for visibility)
        for (const categoryKey of Object.keys(byStationType)) {
            if (categoryKey === 'PAINTBALL') {
                // Always keep paintball in the response, even if zero
                if (byStationType[categoryKey].total === 0) {
                    console.log('Paintball category has no transactions - showing zero');
                }
            } else if (byStationType[categoryKey].total === 0) {
                delete byStationType[categoryKey];
            }
        }

        // If we have transactions but no categories matched, log the station names
        if (Object.keys(byStationType).length === 0 && transactions.length > 0) {
            console.log('❌ NO CATEGORIES MATCHED! Station names in database:');
            Object.keys(byStation).forEach(station => {
                console.log(`  - "${station}"`);
            });
        }

        const pastCount = transactions.filter(tx => tx.is_past === 1 || tx.is_past === true).length;

        res.json({
            date,
            total_transactions: transactions.length,
            total_revenue: transactions.reduce((sum, tx) => sum + tx.total_amount, 0),
            past_count: pastCount,
            by_method: byMethod,
            by_hour: byHour,
            by_cashier: byCashier,
            by_station: byStation,
            by_station_type: byStationType,
            paintball_found: paintballFound  // Add flag for frontend
        });
    } catch (error) {
        console.error('Report generation error:', error);
        res.status(500).json({ error: 'Failed to generate report: ' + error.message });
    }
});

// Other routes remain unchanged...
router.get('/range', authenticateToken, async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ error: 'From and to dates are required.' });

        const filters = { date_from: from, date_to: to, include_void: 'false' };
        let transactions = await store.getTransactions(filters);
        transactions = transactions.filter(tx => tx.payment_status === 'completed');

        const byDate = {};
        transactions.forEach(tx => {
            const date = tx.transaction_date;
            if (!byDate[date]) byDate[date] = { count: 0, total: 0, cash: 0, mpesa: 0, credit: 0 };
            byDate[date].count++;
            byDate[date].total += tx.total_amount;
            if (tx.payment_method === 'Cash') byDate[date].cash += tx.total_amount;
            else if (tx.payment_method === 'Mpesa') byDate[date].mpesa += tx.total_amount;
            else if (tx.payment_method === 'Credit') byDate[date].credit += tx.total_amount;
        });

        res.json({ from, to, total_transactions: transactions.length, total_revenue: transactions.reduce((sum, tx) => sum + tx.total_amount, 0), by_date: byDate });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate range report.' });
    }
});

router.get('/export/csv/:date', authenticateToken, async (req, res) => {
    try {
        const date = req.params.date;
        const includePast = req.query.include_past === 'true';
        const filters = { date: date, include_void: 'false' };
        if (includePast) filters.include_past = 'true';

        let transactions = await store.getTransactions(filters);
        transactions = transactions.filter(tx => tx.payment_status === 'completed');

        if (!includePast) {
            transactions = transactions.filter(tx => {
                return !tx.is_past || tx.transaction_date === date;
            });
        }

        transactions.sort((a, b) => (a.transaction_time || '').localeCompare(b.transaction_time || ''));

        const totalRevenue = transactions.reduce((sum, tx) => sum + tx.total_amount, 0);
        const pastCount = transactions.filter(tx => tx.is_past === 1 || tx.is_past === true).length;

        const rows = [
            'VR LOUNGE - DAILY SALES REPORT',
            `Date: ${date}`,
            `Generated: ${new Date().toLocaleString()}`,
            pastCount > 0 ? `Includes ${pastCount} backdated transaction(s) for this date` : '',
            '',
            `Total Transactions,${transactions.length}`,
            `Total Revenue,KES ${totalRevenue.toLocaleString()}`,
            '',
            'Receipt No,Time,Customer,Amount,Paid,Balance,Method,Cashier,Station,Past Transaction'
        ];

        transactions.forEach(tx => {
            rows.push([
                tx.receipt_no, tx.transaction_time || '',
                `"${(tx.customer_name || 'Guest').replace(/"/g, '""')}"`,
                tx.total_amount, tx.amount_paid || 0, tx.balance || 0,
                tx.payment_method,
                `"${(tx.cashier_name || '').replace(/"/g, '""')}"`,
                `"${(tx.station_used || '').replace(/"/g, '""')}"`,
                tx.is_past ? 'YES' : 'NO'
            ].join(','));
        });

        const csv = rows.join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="VR_Report_${date}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to export CSV.' });
    }
});

router.get('/export/text/:date', authenticateToken, async (req, res) => {
    try {
        const date = req.params.date;
        const includePast = req.query.include_past === 'true';
        const filters = { date: date, include_void: 'false' };
        if (includePast) filters.include_past = 'true';

        let transactions = await store.getTransactions(filters);
        transactions = transactions.filter(tx => tx.payment_status === 'completed');

        if (!includePast) {
            transactions = transactions.filter(tx => {
                return !tx.is_past || tx.transaction_date === date;
            });
        }

        const totalRevenue = transactions.reduce((sum, tx) => sum + tx.total_amount, 0);
        const cashTotal = transactions.filter(tx => tx.payment_method === 'Cash').reduce((sum, tx) => sum + tx.total_amount, 0);
        const mpesaTotal = transactions.filter(tx => tx.payment_method === 'Mpesa').reduce((sum, tx) => sum + tx.total_amount, 0);
        const creditTotal = transactions.filter(tx => tx.payment_method === 'Credit').reduce((sum, tx) => sum + tx.total_amount, 0);
        const pastCount = transactions.filter(tx => tx.is_past === 1 || tx.is_past === true).length;

        // Category definitions with isolated Paintball
        const categoryDefinitions = {
            'POOL': { name: 'POOL TABLE', patterns: ['pool', 'billiard'] },
            'VR': { name: 'VR EXPERIENCE', patterns: ['vr', 'virtual reality', 'oculus', 'quest'] },
            'PLAYSTATION': { name: 'PLAYSTATION (PS4/PS5)', patterns: ['ps5', 'ps4', 'playstation', 'play station'] },
            'DARTS': { name: 'DARTS', patterns: ['dart'] },
            'FOOSBALL': { name: 'FOOSBALL', patterns: ['foosball', 'foos ball', 'foos'] },
            'RACE SIMULATOR': { name: 'RACE SIMULATOR', patterns: ['race', 'racing', 'simulator'] },
            'PAINTBALL': { name: 'PAINTBALL (ISOLATED)', patterns: ['paintball', 'paint ball'], isolated: true }
        };

        const byStationType = {};
        for (const [type, data] of Object.entries(categoryDefinitions)) {
            byStationType[type] = { name: data.name, cash: 0, mpesa: 0, credit: 0, total: 0, isolated: data.isolated || false };
        }

        transactions.forEach(tx => {
            const stn = (tx.station_used || '').toLowerCase().trim();
            for (const [type, data] of Object.entries(categoryDefinitions)) {
                if (data.patterns.some(pattern => stn.includes(pattern))) {
                    if (tx.payment_method === 'Cash') byStationType[type].cash += tx.total_amount;
                    else if (tx.payment_method === 'Mpesa') byStationType[type].mpesa += tx.total_amount;
                    else if (tx.payment_method === 'Credit') byStationType[type].credit += tx.total_amount;
                    byStationType[type].total += tx.total_amount;
                    break;
                }
            }
        });

        let stationBreakdown = '';
        let paintballBreakdown = '';
        let otherGamesTotal = 0;
        let paintballTotal = 0;

        for (const [type, data] of Object.entries(byStationType)) {
            if (data.total > 0 || type === 'PAINTBALL') {
                const breakdownText = `\n${data.name}:\n` +
                    `  Total Cash:    KES ${data.cash.toLocaleString()}\n` +
                    `  Total M-Pesa:  KES ${data.mpesa.toLocaleString()}\n` +
                    `  Total Credit:  KES ${data.credit.toLocaleString()}\n` +
                    `  TOTAL AMOUNT:  KES ${data.total.toLocaleString()}\n`;

                if (data.isolated || type === 'PAINTBALL') {
                    paintballBreakdown += breakdownText;
                    paintballTotal += data.total;
                } else {
                    stationBreakdown += breakdownText;
                    otherGamesTotal += data.total;
                }
            }
        }

        let pastNote = '';
        if (pastCount > 0) {
            pastNote = `\n📅 NOTE: This report includes ${pastCount} backdated/past transaction(s) for this date.\n`;
        }

        let paintballSection = '';
        if (paintballBreakdown) {
            paintballSection = `\n========================================
       PAINTBALL SECTION (ISOLATED)
========================================${paintballBreakdown}`;
        } else {
            paintballSection = `\n========================================
       PAINTBALL SECTION (ISOLATED)
========================================
No Paintball transactions for this date.\n`;
        }

        const text = `========================================
   VR LOUNGE - DAILY SALES REPORT
========================================
Date: ${date}
Generated: ${new Date().toLocaleString()}
${pastNote}
========================================
           PAYMENT SUMMARY
========================================
Total Transactions: ${transactions.length}
Total Revenue:      KES ${totalRevenue.toLocaleString()}

Cash:               KES ${cashTotal.toLocaleString()}
M-Pesa:             KES ${mpesaTotal.toLocaleString()}
Credit:             KES ${creditTotal.toLocaleString()}

========================================
       OTHER GAMES BREAKDOWN
========================================${stationBreakdown || 'No other game transactions for this date.\n'}
========================================
       PAINTBALL BREAKDOWN (ISOLATED)
========================================${paintballSection}
========================================
         CLOSING SUMMARY
========================================
OTHER GAMES TOTAL:   KES ${otherGamesTotal.toLocaleString()}
PAINTBALL TOTAL:     KES ${paintballTotal.toLocaleString()}
TOTAL CASH:          KES ${cashTotal.toLocaleString()}
TOTAL M-PESA:        KES ${mpesaTotal.toLocaleString()}
TOTAL CREDIT:        KES ${creditTotal.toLocaleString()}
GRAND TOTAL:         KES ${totalRevenue.toLocaleString()}

CLOSING FLOAT AMT:   KES ${cashTotal.toLocaleString()}
(Petty Cash to Bank)

========================================
Generated by VR Billing System
========================================`;

        res.setHeader('Content-Type', 'text/plain');
        res.send(text);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to export text.' });
    }
});

router.get('/export/print/:date', authenticateToken, async (req, res) => {
    try {
        const date = req.params.date;
        const includePast = req.query.include_past === 'true';
        const filters = { date: date, include_void: 'false' };
        if (includePast) filters.include_past = 'true';

        let transactions = await store.getTransactions(filters);
        transactions = transactions.filter(tx => tx.payment_status === 'completed');

        if (!includePast) {
            transactions = transactions.filter(tx => {
                return !tx.is_past || tx.transaction_date === date;
            });
        }

        transactions.sort((a, b) => (a.transaction_time || '').localeCompare(b.transaction_time || ''));

        const totalRevenue = transactions.reduce((sum, tx) => sum + tx.total_amount, 0);
        const cashTotal = transactions.filter(tx => tx.payment_method === 'Cash').reduce((sum, tx) => sum + tx.total_amount, 0);
        const mpesaTotal = transactions.filter(tx => tx.payment_method === 'Mpesa').reduce((sum, tx) => sum + tx.total_amount, 0);
        const creditTotal = transactions.filter(tx => tx.payment_method === 'Credit').reduce((sum, tx) => sum + tx.total_amount, 0);
        const pastCount = transactions.filter(tx => tx.is_past === 1 || tx.is_past === true).length;

        const rowsHTML = transactions.map(tx => {
            const pastBadge = tx.is_past ? '<span style="background:#e8d5f5;color:#6f42c1;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:5px;">📅 Past</span>' : '';
            return `
            <tr><td style="text-align:left;font-size:14px;">${tx.receipt_no}${pastBadge}</td>
            <td style="text-align:center;font-size:14px;">${tx.transaction_time || ''}</td>
            <td style="text-align:left;font-size:14px;">${tx.customer_name || 'Guest'}</td>
            <td style="text-align:right;font-size:14px;">KES ${(tx.total_amount || 0).toLocaleString()}</td>
            <td style="text-align:center;font-size:14px;">${tx.payment_method}</td>
            <td style="text-align:left;font-size:14px;">${tx.cashier_name || '-'}</td>
            <td style="text-align:left;font-size:14px;">${tx.station_used || '-'}</td>
            </tr>`;
        }).join('');

        const pastNote = pastCount > 0 ? `<p style="background:#e8d5f5;padding:10px;border-radius:8px;margin-bottom:15px;"><strong>📅 Note:</strong> This report includes ${pastCount} backdated/past transaction(s) for this date.</p>` : '';

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report ${date}</title>
        <style>body{font-family:sans-serif;padding:30px;}h1{color:#667eea;}table{width:100%;border-collapse:collapse;}
        th{background:#667eea;color:white;padding:10px;text-align:left;}td{padding:8px;border-bottom:1px solid #eee;}
        .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin:20px 0;}
        .card{background:#f8f9fa;padding:15px;border-radius:8px;text-align:center;}
        .card .val{font-size:24px;font-weight:bold;color:#667eea;}
        .payment-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin:20px 0;}
        .payment-card{background:#fff;padding:15px;border-radius:8px;text-align:center;border:2px solid #e0e0e0;}
        .payment-card.cash{border-color:#28a745;}
        .payment-card.mpesa{border-color:#17a2b8;}
        .payment-card.credit{border-color:#ffc107;}
        .payment-card.total{border-color:#667eea;}
        @media print{body{padding:10px;}}</style></head>
        <body><h1>VR Lounge - Daily Report</h1><p>Date: ${date}</p>
        ${pastNote}
        <div class="summary"><div class="card"><div class="val">${transactions.length}</div>Transactions</div>
        <div class="card"><div class="val">KES ${totalRevenue.toLocaleString()}</div>Revenue</div>
        <div class="card"><div class="val">KES ${cashTotal.toLocaleString()}</div>Cash</div></div>
        <div class="payment-summary">
        <div class="payment-card cash"><strong>💵 Cash</strong><br>KES ${cashTotal.toLocaleString()}</div>
        <div class="payment-card mpesa"><strong>📱 M-Pesa</strong><br>KES ${mpesaTotal.toLocaleString()}</div>
        <div class="payment-card credit"><strong>📝 Credit</strong><br>KES ${creditTotal.toLocaleString()}</div>
        <div class="payment-card total"><strong>💰 Total</strong><br>KES ${totalRevenue.toLocaleString()}</div>
        </div>
        <table><thead><tr><th>Receipt</th><th>Time</th><th>Customer</th><th>Amount</th><th>Method</th><th>Cashier</th><th>Station</th></tr></thead>
        <tbody>${rowsHTML || '<tr><td colspan="7">No transactions</td></tr>'}</tbody>
        </table>
        <div style="margin-top:20px;text-align:center;color:#666;">
        <p><strong>CLOSING FLOAT (Petty Cash): KES ${cashTotal.toLocaleString()}</strong></p>
        </div></body></html>`;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate print report.' });
    }
});

module.exports = router;