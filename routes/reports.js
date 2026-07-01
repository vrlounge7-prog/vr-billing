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

        // --- FIXED: Process by individual items instead of whole transaction ---
        const byMethod = {};
        const byHour = {};
        const byCashier = {};
        const byStation = {};

        // Define category definitions with detection patterns
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
                isolated: true
            }
        };

        // Initialize category tracking
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

        // Process each transaction
        transactions.forEach(tx => {
            // --- PAYMENT METHOD BREAKDOWN WITH SPLIT SUPPORT ---
            let method = tx.payment_method || 'Unknown';
            
            // Check if this is a split payment
            if (method === 'Split' || method === 'Split (Cash + M-Pesa)') {
                let splitData = null;
                try {
                    if (tx.credit_details && typeof tx.credit_details === 'string') {
                        splitData = JSON.parse(tx.credit_details);
                    } else if (tx.credit_details && typeof tx.credit_details === 'object') {
                        splitData = tx.credit_details;
                    }
                } catch (e) {}
                
                if (splitData && splitData.type === 'split') {
                    // Count as split payment
                    if (!byMethod['Split']) byMethod['Split'] = { count: 0, total: 0 };
                    byMethod['Split'].count++;
                    byMethod['Split'].total += tx.total_amount;
                    
                    // Also track individual components for detailed reporting
                    if (splitData.cash > 0) {
                        if (!byMethod['Split-Cash']) byMethod['Split-Cash'] = { count: 0, total: 0 };
                        byMethod['Split-Cash'].count++;
                        byMethod['Split-Cash'].total += splitData.cash;
                    }
                    if (splitData.mpesa > 0) {
                        if (!byMethod['Split-Mpesa']) byMethod['Split-Mpesa'] = { count: 0, total: 0 };
                        byMethod['Split-Mpesa'].count++;
                        byMethod['Split-Mpesa'].total += splitData.mpesa;
                    }
                } else {
                    // Fallback: treat as regular method
                    if (!byMethod[method]) byMethod[method] = { count: 0, total: 0 };
                    byMethod[method].count++;
                    byMethod[method].total += tx.total_amount;
                }
            } else {
                // Regular method counting
                if (!byMethod[method]) byMethod[method] = { count: 0, total: 0 };
                byMethod[method].count++;
                byMethod[method].total += tx.total_amount;
            }

            // By Hour
            const hour = tx.transaction_time ? tx.transaction_time.split(':')[0] : '00';
            const hourKey = `${hour}:00`;
            if (!byHour[hourKey]) byHour[hourKey] = { count: 0, total: 0 };
            byHour[hourKey].count++;
            byHour[hourKey].total += tx.total_amount;

            // By Cashier
            const name = tx.cashier_name || 'Unknown';
            if (!byCashier[name]) byCashier[name] = { count: 0, total: 0 };
            byCashier[name].count++;
            byCashier[name].total += tx.total_amount;

            // ---- CRITICAL FIX: Parse items and categorize each individually ----
            let items = [];
            try {
                items = JSON.parse(tx.items_json || '[]');
            } catch (e) {
                // If parsing fails, fallback to station_used
                const stn = tx.station_used || 'Unknown';
                if (!byStation[stn]) byStation[stn] = { count: 0, total: 0, cash: 0, mpesa: 0, credit: 0 };
                byStation[stn].count++;
                byStation[stn].total += tx.total_amount;
                if (tx.payment_method === 'Cash') byStation[stn].cash += tx.total_amount;
                else if (tx.payment_method === 'Mpesa') byStation[stn].mpesa += tx.total_amount;
                else if (tx.payment_method === 'Credit') byStation[stn].credit += tx.total_amount;
                // Check for split payment
                else if (tx.payment_method === 'Split' || tx.payment_method === 'Split (Cash + M-Pesa)') {
                    let splitData = null;
                    try {
                        if (tx.credit_details && typeof tx.credit_details === 'string') {
                            splitData = JSON.parse(tx.credit_details);
                        } else if (tx.credit_details && typeof tx.credit_details === 'object') {
                            splitData = tx.credit_details;
                        }
                    } catch (err) {}
                    if (splitData && splitData.type === 'split') {
                        byStation[stn].cash += splitData.cash || 0;
                        byStation[stn].mpesa += splitData.mpesa || 0;
                    }
                }
                return;
            }

            // If no items, skip
            if (!items || items.length === 0) {
                const stn = tx.station_used || 'Unknown';
                if (!byStation[stn]) byStation[stn] = { count: 0, total: 0, cash: 0, mpesa: 0, credit: 0 };
                byStation[stn].count++;
                byStation[stn].total += tx.total_amount;
                if (tx.payment_method === 'Cash') byStation[stn].cash += tx.total_amount;
                else if (tx.payment_method === 'Mpesa') byStation[stn].mpesa += tx.total_amount;
                else if (tx.payment_method === 'Credit') byStation[stn].credit += tx.total_amount;
                else if (tx.payment_method === 'Split' || tx.payment_method === 'Split (Cash + M-Pesa)') {
                    let splitData = null;
                    try {
                        if (tx.credit_details && typeof tx.credit_details === 'string') {
                            splitData = JSON.parse(tx.credit_details);
                        } else if (tx.credit_details && typeof tx.credit_details === 'object') {
                            splitData = tx.credit_details;
                        }
                    } catch (err) {}
                    if (splitData && splitData.type === 'split') {
                        byStation[stn].cash += splitData.cash || 0;
                        byStation[stn].mpesa += splitData.mpesa || 0;
                    }
                }
                return;
            }

            // Process each individual item in the transaction
            items.forEach(item => {
                const itemName = (item.game_name || item.name || '').toLowerCase().trim();
                const stationName = (item.station_name || tx.station_used || '').toLowerCase().trim();
                const itemPrice = item.total_price || item.price || (tx.total_amount / items.length);
                
                // Track by station (for backward compatibility)
                const stn = item.station_name || tx.station_used || 'Unknown';
                if (!byStation[stn]) byStation[stn] = { count: 0, total: 0, cash: 0, mpesa: 0, credit: 0 };
                byStation[stn].count++;
                byStation[stn].total += itemPrice;
                
                // Determine payment method for this item (split by proportion)
                let methodForItem = tx.payment_method;
                let cashPortion = 0;
                let mpesaPortion = 0;
                
                if (tx.payment_method === 'Split' || tx.payment_method === 'Split (Cash + M-Pesa)') {
                    let splitData = null;
                    try {
                        if (tx.credit_details && typeof tx.credit_details === 'string') {
                            splitData = JSON.parse(tx.credit_details);
                        } else if (tx.credit_details && typeof tx.credit_details === 'object') {
                            splitData = tx.credit_details;
                        }
                    } catch (e) {}
                    
                    if (splitData && splitData.type === 'split' && splitData.total > 0) {
                        // Allocate proportionally
                        const proportion = itemPrice / tx.total_amount;
                        cashPortion = splitData.cash * proportion;
                        mpesaPortion = splitData.mpesa * proportion;
                    }
                }
                
                if (cashPortion > 0 || mpesaPortion > 0) {
                    byStation[stn].cash += cashPortion;
                    byStation[stn].mpesa += mpesaPortion;
                } else if (tx.payment_method === 'Cash') {
                    byStation[stn].cash += itemPrice;
                } else if (tx.payment_method === 'Mpesa') {
                    byStation[stn].mpesa += itemPrice;
                } else if (tx.payment_method === 'Credit') {
                    byStation[stn].credit += itemPrice;
                }

                // Categorize the item by its name/station
                let matched = false;
                const searchString = (itemName + ' ' + stationName).toLowerCase();
                
                for (const [categoryKey, categoryDef] of Object.entries(categoryDefinitions)) {
                    const isMatch = categoryDef.patterns.some(pattern => 
                        searchString.includes(pattern)
                    );

                    if (isMatch) {
                        // Use the same proportional allocation for category breakdown
                        if (cashPortion > 0 || mpesaPortion > 0) {
                            byStationType[categoryKey].cash += cashPortion;
                            byStationType[categoryKey].mpesa += mpesaPortion;
                        } else if (tx.payment_method === 'Cash') {
                            byStationType[categoryKey].cash += itemPrice;
                        } else if (tx.payment_method === 'Mpesa') {
                            byStationType[categoryKey].mpesa += itemPrice;
                        } else if (tx.payment_method === 'Credit') {
                            byStationType[categoryKey].credit += itemPrice;
                        }
                        byStationType[categoryKey].total += itemPrice;
                        byStationType[categoryKey].count++;
                        matched = true;
                        break;
                    }
                }

                // If no category matched, log it as "Other"
                if (!matched) {
                    if (!byStationType['OTHER']) {
                        byStationType['OTHER'] = {
                            name: 'OTHER SERVICES',
                            icon: '📌',
                            cash: 0,
                            mpesa: 0,
                            credit: 0,
                            total: 0,
                            count: 0,
                            isolated: false
                        };
                    }
                    if (cashPortion > 0 || mpesaPortion > 0) {
                        byStationType['OTHER'].cash += cashPortion;
                        byStationType['OTHER'].mpesa += mpesaPortion;
                    } else if (tx.payment_method === 'Cash') {
                        byStationType['OTHER'].cash += itemPrice;
                    } else if (tx.payment_method === 'Mpesa') {
                        byStationType['OTHER'].mpesa += itemPrice;
                    } else if (tx.payment_method === 'Credit') {
                        byStationType['OTHER'].credit += itemPrice;
                    }
                    byStationType['OTHER'].total += itemPrice;
                    byStationType['OTHER'].count++;
                    
                    // Log unmatched items for debugging
                    console.log(`⚠️ UNMATCHED ITEM: "${itemName}" | Station: "${stationName}"`);
                }
            });
        });

        // Remove empty non-paintball categories
        for (const categoryKey of Object.keys(byStationType)) {
            if (categoryKey !== 'PAINTBALL' && byStationType[categoryKey].total === 0) {
                delete byStationType[categoryKey];
            }
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
            by_station_type: byStationType
        });
    } catch (error) {
        console.error('Report generation error:', error);
        res.status(500).json({ error: 'Failed to generate report: ' + error.message });
    }
});

// ============ RANGE REPORT ============
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
            if (!byDate[date]) byDate[date] = { count: 0, total: 0, cash: 0, mpesa: 0, credit: 0, split: 0 };
            byDate[date].count++;
            byDate[date].total += tx.total_amount;
            
            // Handle split payments in range report
            if (tx.payment_method === 'Split' || tx.payment_method === 'Split (Cash + M-Pesa)') {
                let splitData = null;
                try {
                    if (tx.credit_details && typeof tx.credit_details === 'string') {
                        splitData = JSON.parse(tx.credit_details);
                    } else if (tx.credit_details && typeof tx.credit_details === 'object') {
                        splitData = tx.credit_details;
                    }
                } catch (e) {}
                
                if (splitData && splitData.type === 'split') {
                    byDate[date].cash += splitData.cash || 0;
                    byDate[date].mpesa += splitData.mpesa || 0;
                    byDate[date].split += tx.total_amount;
                }
            } else if (tx.payment_method === 'Cash') {
                byDate[date].cash += tx.total_amount;
            } else if (tx.payment_method === 'Mpesa') {
                byDate[date].mpesa += tx.total_amount;
            } else if (tx.payment_method === 'Credit') {
                byDate[date].credit += tx.total_amount;
            }
        });

        res.json({ from, to, total_transactions: transactions.length, total_revenue: transactions.reduce((sum, tx) => sum + tx.total_amount, 0), by_date: byDate });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate range report.' });
    }
});

// ============ CSV EXPORT ============
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

// ============ TEXT EXPORT ============
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
        let cashTotal = 0;
        let mpesaTotal = 0;
        let creditTotal = 0;
        let splitTotal = 0;
        
        // Calculate payment totals with split support
        transactions.forEach(tx => {
            if (tx.payment_method === 'Split' || tx.payment_method === 'Split (Cash + M-Pesa)') {
                let splitData = null;
                try {
                    if (tx.credit_details && typeof tx.credit_details === 'string') {
                        splitData = JSON.parse(tx.credit_details);
                    } else if (tx.credit_details && typeof tx.credit_details === 'object') {
                        splitData = tx.credit_details;
                    }
                } catch (e) {}
                
                if (splitData && splitData.type === 'split') {
                    cashTotal += splitData.cash || 0;
                    mpesaTotal += splitData.mpesa || 0;
                    splitTotal += tx.total_amount;
                }
            } else if (tx.payment_method === 'Cash') {
                cashTotal += tx.total_amount;
            } else if (tx.payment_method === 'Mpesa') {
                mpesaTotal += tx.total_amount;
            } else if (tx.payment_method === 'Credit') {
                creditTotal += tx.total_amount;
            }
        });
        
        const pastCount = transactions.filter(tx => tx.is_past === 1 || tx.is_past === true).length;

        // Category definitions
        const categoryDefinitions = {
            'POOL': { name: 'POOL TABLE', patterns: ['pool', 'billiard'] },
            'VR': { name: 'VR EXPERIENCE', patterns: ['vr', 'virtual reality', 'oculus', 'quest'] },
            'PLAYSTATION': { name: 'PLAYSTATION (PS4/PS5)', patterns: ['ps5', 'ps4', 'playstation', 'play station'] },
            'DARTS': { name: 'DARTS', patterns: ['dart'] },
            'FOOSBALL': { name: 'FOOSBALL', patterns: ['foosball', 'foos ball', 'foos'] },
            'RACE SIMULATOR': { name: 'RACE SIMULATOR', patterns: ['race', 'racing', 'simulator'] },
            'PAINTBALL': { name: 'PAINTBALL (ISOLATED)', patterns: ['paintball', 'paint ball'], isolated: true }
        };

        // Initialize category tracking
        const byStationType = {};
        for (const [type, data] of Object.entries(categoryDefinitions)) {
            byStationType[type] = { 
                name: data.name, 
                cash: 0, 
                mpesa: 0, 
                credit: 0, 
                total: 0, 
                count: 0,
                isolated: data.isolated || false 
            };
        }

        // ---- FIXED: Process each transaction's items individually ----
        transactions.forEach(tx => {
            let items = [];
            try {
                items = JSON.parse(tx.items_json || '[]');
            } catch (e) {
                // Fallback: use station_used
                const stn = (tx.station_used || '').toLowerCase().trim();
                for (const [type, data] of Object.entries(categoryDefinitions)) {
                    if (data.patterns.some(pattern => stn.includes(pattern))) {
                        const amount = tx.total_amount;
                        if (tx.payment_method === 'Cash') byStationType[type].cash += amount;
                        else if (tx.payment_method === 'Mpesa') byStationType[type].mpesa += amount;
                        else if (tx.payment_method === 'Credit') byStationType[type].credit += amount;
                        else if (tx.payment_method === 'Split' || tx.payment_method === 'Split (Cash + M-Pesa)') {
                            let splitData = null;
                            try {
                                if (tx.credit_details && typeof tx.credit_details === 'string') {
                                    splitData = JSON.parse(tx.credit_details);
                                } else if (tx.credit_details && typeof tx.credit_details === 'object') {
                                    splitData = tx.credit_details;
                                }
                            } catch (err) {}
                            if (splitData && splitData.type === 'split') {
                                const proportion = amount / tx.total_amount;
                                byStationType[type].cash += splitData.cash * proportion;
                                byStationType[type].mpesa += splitData.mpesa * proportion;
                            }
                        }
                        byStationType[type].total += amount;
                        byStationType[type].count++;
                        break;
                    }
                }
                return;
            }

            if (!items || items.length === 0) return;

            // Process each item
            items.forEach(item => {
                const itemName = (item.game_name || item.name || '').toLowerCase().trim();
                const stationName = (item.station_name || tx.station_used || '').toLowerCase().trim();
                const amount = item.total_price || item.price || (tx.total_amount / items.length);

                const searchString = (itemName + ' ' + stationName).toLowerCase();
                let matched = false;

                // Determine split proportions for this item
                let cashPortion = 0;
                let mpesaPortion = 0;
                let creditPortion = 0;
                
                if (tx.payment_method === 'Split' || tx.payment_method === 'Split (Cash + M-Pesa)') {
                    let splitData = null;
                    try {
                        if (tx.credit_details && typeof tx.credit_details === 'string') {
                            splitData = JSON.parse(tx.credit_details);
                        } else if (tx.credit_details && typeof tx.credit_details === 'object') {
                            splitData = tx.credit_details;
                        }
                    } catch (e) {}
                    
                    if (splitData && splitData.type === 'split' && splitData.total > 0) {
                        const proportion = amount / tx.total_amount;
                        cashPortion = splitData.cash * proportion;
                        mpesaPortion = splitData.mpesa * proportion;
                    }
                }

                for (const [type, data] of Object.entries(categoryDefinitions)) {
                    if (data.patterns.some(pattern => searchString.includes(pattern))) {
                        if (cashPortion > 0 || mpesaPortion > 0) {
                            byStationType[type].cash += cashPortion;
                            byStationType[type].mpesa += mpesaPortion;
                        } else if (tx.payment_method === 'Cash') {
                            byStationType[type].cash += amount;
                        } else if (tx.payment_method === 'Mpesa') {
                            byStationType[type].mpesa += amount;
                        } else if (tx.payment_method === 'Credit') {
                            byStationType[type].credit += amount;
                        }
                        byStationType[type].total += amount;
                        byStationType[type].count++;
                        matched = true;
                        break;
                    }
                }

                if (!matched) {
                    // Log unmatched
                    console.log(`⚠️ TEXT EXPORT - UNMATCHED ITEM: "${itemName}" | Station: "${stationName}"`);
                    if (!byStationType['OTHER']) {
                        byStationType['OTHER'] = { 
                            name: 'OTHER SERVICES', 
                            cash: 0, 
                            mpesa: 0, 
                            credit: 0, 
                            total: 0, 
                            count: 0,
                            isolated: false 
                        };
                    }
                    if (cashPortion > 0 || mpesaPortion > 0) {
                        byStationType['OTHER'].cash += cashPortion;
                        byStationType['OTHER'].mpesa += mpesaPortion;
                    } else if (tx.payment_method === 'Cash') {
                        byStationType['OTHER'].cash += amount;
                    } else if (tx.payment_method === 'Mpesa') {
                        byStationType['OTHER'].mpesa += amount;
                    } else if (tx.payment_method === 'Credit') {
                        byStationType['OTHER'].credit += amount;
                    }
                    byStationType['OTHER'].total += amount;
                    byStationType['OTHER'].count++;
                }
            });
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
                    `  TOTAL AMOUNT:  KES ${data.total.toLocaleString()}\n` +
                    `  Transactions:  ${data.count}\n`;

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

        let splitNote = '';
        if (splitTotal > 0) {
            splitNote = `\n💳 Split Payments: KES ${splitTotal.toLocaleString()}\n`;
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
${pastNote}${splitNote}
========================================
           PAYMENT SUMMARY
========================================
Total Transactions: ${transactions.length}
Total Revenue:      KES ${totalRevenue.toLocaleString()}

Cash:               KES ${cashTotal.toLocaleString()}
M-Pesa:             KES ${mpesaTotal.toLocaleString()}
Credit:             KES ${creditTotal.toLocaleString()}
Split Payments:     KES ${splitTotal.toLocaleString()}

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

// ============ PRINT REPORT ============
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
        let cashTotal = 0;
        let mpesaTotal = 0;
        let creditTotal = 0;
        let splitTotal = 0;
        
        // Calculate payment totals with split support
        transactions.forEach(tx => {
            if (tx.payment_method === 'Split' || tx.payment_method === 'Split (Cash + M-Pesa)') {
                let splitData = null;
                try {
                    if (tx.credit_details && typeof tx.credit_details === 'string') {
                        splitData = JSON.parse(tx.credit_details);
                    } else if (tx.credit_details && typeof tx.credit_details === 'object') {
                        splitData = tx.credit_details;
                    }
                } catch (e) {}
                
                if (splitData && splitData.type === 'split') {
                    cashTotal += splitData.cash || 0;
                    mpesaTotal += splitData.mpesa || 0;
                    splitTotal += tx.total_amount;
                }
            } else if (tx.payment_method === 'Cash') {
                cashTotal += tx.total_amount;
            } else if (tx.payment_method === 'Mpesa') {
                mpesaTotal += tx.total_amount;
            } else if (tx.payment_method === 'Credit') {
                creditTotal += tx.total_amount;
            }
        });
        
        const pastCount = transactions.filter(tx => tx.is_past === 1 || tx.is_past === true).length;

        const rowsHTML = transactions.map(tx => {
            const pastBadge = tx.is_past ? '<span style="background:#e8d5f5;color:#6f42c1;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:5px;">📅 Past</span>' : '';
            // Get items for display
            let itemsDisplay = '';
            try {
                const items = JSON.parse(tx.items_json || '[]');
                itemsDisplay = items.map(item => `${item.game_name || 'Item'}`).join(', ');
            } catch (e) {
                itemsDisplay = tx.past_game || tx.station_used || '-';
            }
            
            // Show split payment info
            let methodDisplay = tx.payment_method;
            if (tx.payment_method === 'Split' || tx.payment_method === 'Split (Cash + M-Pesa)') {
                let splitData = null;
                try {
                    if (tx.credit_details && typeof tx.credit_details === 'string') {
                        splitData = JSON.parse(tx.credit_details);
                    } else if (tx.credit_details && typeof tx.credit_details === 'object') {
                        splitData = tx.credit_details;
                    }
                } catch (e) {}
                if (splitData && splitData.type === 'split') {
                    methodDisplay = `Split (Cash: ${splitData.cash || 0}, M-Pesa: ${splitData.mpesa || 0})`;
                }
            }
            
            return `
            <tr><td style="text-align:left;font-size:14px;">${tx.receipt_no}${pastBadge}</td>
            <td style="text-align:center;font-size:14px;">${tx.transaction_time || ''}</td>
            <td style="text-align:left;font-size:14px;">${tx.customer_name || 'Guest'}</td>
            <td style="text-align:right;font-size:14px;">KES ${(tx.total_amount || 0).toLocaleString()}</td>
            <td style="text-align:center;font-size:14px;">${methodDisplay}</td>
            <td style="text-align:left;font-size:14px;">${tx.cashier_name || '-'}</td>
            <td style="text-align:left;font-size:14px;">${itemsDisplay}</td>
            </tr>`;
        }).join('');

        const pastNote = pastCount > 0 ? `<p style="background:#e8d5f5;padding:10px;border-radius:8px;margin-bottom:15px;"><strong>📅 Note:</strong> This report includes ${pastCount} backdated/past transaction(s) for this date.</p>` : '';
        const splitNote = splitTotal > 0 ? `<p style="background:#fff3cd;padding:10px;border-radius:8px;margin-bottom:15px;"><strong>💳 Split Payments:</strong> KES ${splitTotal.toLocaleString()}</p>` : '';

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report ${date}</title>
        <style>body{font-family:sans-serif;padding:30px;}h1{color:#667eea;}table{width:100%;border-collapse:collapse;}
        th{background:#667eea;color:white;padding:10px;text-align:left;}td{padding:8px;border-bottom:1px solid #eee;}
        .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin:20px 0;}
        .card{background:#f8f9fa;padding:15px;border-radius:8px;text-align:center;}
        .card .val{font-size:24px;font-weight:bold;color:#667eea;}
        .payment-summary{display:grid;grid-template-columns:repeat(5,1fr);gap:15px;margin:20px 0;}
        .payment-card{background:#fff;padding:15px;border-radius:8px;text-align:center;border:2px solid #e0e0e0;}
        .payment-card.cash{border-color:#28a745;}
        .payment-card.mpesa{border-color:#17a2b8;}
        .payment-card.credit{border-color:#ffc107;}
        .payment-card.split{border-color:#ff6b35;}
        .payment-card.total{border-color:#667eea;}
        @media print{body{padding:10px;}}</style></head>
        <body><h1>VR Lounge - Daily Report</h1><p>Date: ${date}</p>
        ${pastNote}${splitNote}
        <div class="summary"><div class="card"><div class="val">${transactions.length}</div>Transactions</div>
        <div class="card"><div class="val">KES ${totalRevenue.toLocaleString()}</div>Revenue</div>
        <div class="card"><div class="val">KES ${cashTotal.toLocaleString()}</div>Cash</div></div>
        <div class="payment-summary">
        <div class="payment-card cash"><strong>💵 Cash</strong><br>KES ${cashTotal.toLocaleString()}</div>
        <div class="payment-card mpesa"><strong>📱 M-Pesa</strong><br>KES ${mpesaTotal.toLocaleString()}</div>
        <div class="payment-card credit"><strong>📝 Credit</strong><br>KES ${creditTotal.toLocaleString()}</div>
        <div class="payment-card split"><strong>💳 Split</strong><br>KES ${splitTotal.toLocaleString()}</div>
        <div class="payment-card total"><strong>💰 Total</strong><br>KES ${totalRevenue.toLocaleString()}</div>
        </div>
        <table><thead><tr><th>Receipt</th><th>Time</th><th>Customer</th><th>Amount</th><th>Method</th><th>Cashier</th><th>Items</th></tr></thead>
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
