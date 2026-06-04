const express = require('express');
const net = require('net');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

const PRINTER_IP = process.env.PRINTER_IP || '192.168.0.200';
const PRINTER_PORT = process.env.PRINTER_PORT || 9100;

router.post('/receipt', authenticateToken, (req, res) => {
    const { receiptHTML, receiptNo } = req.body;
    if (!receiptHTML) return res.status(400).json({ error: 'Receipt data is required.' });

    const printData = convertToEscPos(receiptHTML);
    const cutCommands = generateCutCommands();

    const client = new net.Socket();
    client.setTimeout(15000);

    client.connect(PRINTER_PORT, PRINTER_IP, () => {
        console.log(`📠 Connected to printer at ${PRINTER_IP}:${PRINTER_PORT}`);
        sendInChunks(client, printData, 512, () => {
            console.log('📄 Print data sent, waiting for buffer...');
            setTimeout(() => {
                console.log('✂️ Sending cut command...');
                client.write(cutCommands, () => {
                    console.log('✅ Cut command sent');
                    setTimeout(() => {
                        client.end();
                        console.log('🔌 Connection closed');
                    }, 400);
                });
            }, 1200);
        });
    });

    client.on('close', () => {
        console.log('✅ Receipt printed and cut');
    });

    client.on('error', (err) => {
        console.error('❌ Printer error:', err.message);
    });

    client.on('timeout', () => {
        console.error('❌ Printer connection timeout');
        client.destroy();
    });

    res.json({ success: true, message: 'Receipt sent to printer.' });
});

function sendInChunks(client, data, chunkSize, callback) {
    let i = 0;
    function sendNext() {
        if (i >= data.length) {
            if (callback) callback();
            return;
        }
        const chunk = data.slice(i, i + chunkSize);
        i += chunkSize;
        client.write(chunk, () => {
            setTimeout(sendNext, 30);
        });
    }
    sendNext();
}

function convertToEscPos(html) {
    let text = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n')
        .replace(/<hr[^>]*>/gi, '\n--------------------------------\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");

    let lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const ESC = '\x1B';
    let cmd = [];

    cmd.push(ESC + '@');
    cmd.push(ESC + 'a' + '\x01');
    cmd.push('VR LOUNGE\n');
    cmd.push('Dintez Solutions LTD\n');
    cmd.push('TELEPHONE NO: +254740547488\n');
    cmd.push(ESC + 'a' + '\x00');
    cmd.push('--------------------------------\n');

    for (let i = 0; i < lines.length; i++) {
        let t = lines[i].trim();
        if (t === 'VR LOUNGE' || t === 'Dintez Solutions LTD' || t === 'TELEPHONE NO: +254740547488') {
            continue;
        }
        if (t.match(/^-{10,}$/)) {
            cmd.push('--------------------------------\n');
            continue;
        }
        cmd.push(t + '\n');
    }

    cmd.push(ESC + 'a' + '\x01');
    cmd.push('THANK YOU! COME AGAIN!\n');
    cmd.push('\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n');

    return cmd.join('');
}

function generateCutCommands() {
    const GS = '\x1D';
    return '\n\n\n' + (GS + 'V' + '\x41' + '\x00');
}

module.exports = router;