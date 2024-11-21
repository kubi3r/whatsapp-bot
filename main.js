const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');

let savedPrompts = readJSON('./prompts.json')
let config = readJSON('./config.json')

if (!fs.existsSync('./prompts.json') || fs.statSync('./prompts.json').size == 0) { // If file doesn't exist/is empty
    fs.writeFileSync('./prompts.json', '{}', { flag: 'w+' })
}

let prompt = config.defaultPrompt

let context = {
    "messages": [
        {"role": "system", "content": prompt}
    ]
}


function readJSON(file) {
    try {
        const data = fs.readFileSync(file);
        return JSON.parse(data);
    } catch (err) {
        throw err;
    }
}

async function saveJSON(file, data) {
    try {
        if (typeof data === 'object') {
            data = JSON.stringify(data, null, 4);
        }
    
        await fs.promises.writeFile(file, data).then(() => {
            console.log('Successfully saved', file)
        })
        
    } catch (error) {
        throw error
    }
}

function resetContext(newPrompt) {
    return {
        messages: [
            { role: 'system', content: newPrompt }
        ]
    }
}

async function generateText(prompt) {
    try {
        if (context.messages.length >= 11) { // Keep 5 messages in memory
            context.messages.splice(1, 2)
        }

        context.messages.push({"role": "user", "content": prompt})

        const result = await axios.post(`https://api.cloudflare.com/client/v4/accounts/${config.workersAccountID}/ai/run/${config.textModel}`, 
            context,
            {
                headers: {
                    'Authorization': `Bearer ${config.workersApiKey}`
                }
            }
        ).then(response => {
            return response.data.result.response
        })

        context.messages.push({"role": "assistant", "content": result})

        return result
    } catch (error) {
        console.log(error)
    }
}

async function summarizeForImageGen(prompt) {
    const result = await axios.post(`https://api.cloudflare.com/client/v4/accounts/${config.workersAccountID}/ai/run/${config.textModel}`, 
        {
            "messages": [
                {"role": "system", "content": `You are a concise and creative summarizer. Your task is to convert AI-generated text responses into prompts suitable for an image generation AI. 

Focus on:

* **Accuracy:** Faithfully capture the main event and key details of the text.
* **Visual clarity:**  Describe elements in a way that is easily understood and translated into visuals.
* **Conciseness:**  Keep the prompt short, focusing on the most essential aspects.
* **Mood:** Convey the overall tone and atmosphere of the AI's response (e.g., humorous, adventurous, dramatic).

Avoid:

* **Subjective interpretations:** Stick to objective descriptions of what happened in the text.
* **Unnecessary details:** Omit background information, character thoughts, or minor events that don't contribute to the main visual.
* **Ambiguity:** Use clear and precise language to minimize misinterpretations by the image AI.

Always prioritize the generation of a single, compelling image that captures the essence of the AI's response.
Reply with ONLY the prompt`},
                {"role": "user", "content": prompt}
            ]
        },
        {
            headers: {
                'Authorization': `Bearer ${config.workersApiKey}`
            }
        }
    ).then(response => {
        return response.data.result.response
    })

    return result
}

async function generateImage(prompt) {
    const result = await axios.post(`https://api.cloudflare.com/client/v4/accounts/${config.workersAccountID}/ai/run/${config.imageModel}`, 
        {prompt: prompt},
        {
            headers: {
                'Authorization': `Bearer ${config.workersApiKey}`
            }
        }
    ).then(response => {
        return response.data.result.image
    })

    return result
}

async function processVoice(audio) {
    const decodedBase = Buffer.from(audio.data, 'base64')

    return await axios.post(`https://api.cloudflare.com/client/v4/accounts/${config.workersAccountID}/ai/run/@cf/openai/whisper`, 
        decodedBase,
        {
            headers: {
                'Authorization': `Bearer ${config.workersApiKey}`
            }
        }
    ).then(response => {
        return response.data.result.text
    })
}

async function createResponse(prompt) {

    let response = await generateText(prompt)
    if (response.startsWith('/')) { // Make sure the bot doesn't get itself into a loop
        while (response.startsWith('/')) {
            response = response.slice(1)
        }
    }

    console.log("Generated response:", response)

    const imagePrompt = await summarizeForImageGen(response)

    const image = await generateImage(imagePrompt)

    console.log("Generated image using prompt:", imagePrompt)

    const media = new MessageMedia('image/jpeg', image)
    return [response, media]
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.once('ready', () => {
    console.log('Started listening for messages')
    if (!config.chatID) {
        console.warn('Chat ID is not set, bot will not respond to any messages until you specify a chat. This can be done by setting it in the config file, or automatically by running /setchat in your chosen channel.')
    }
})

client.on('qr', qr => {
    console.log('Scan in WhatsApp to log in')
    qrcode.generate(qr, {small: true})
})

client.on('message_create', async message => {
    try {
        if (typeof message.body !== 'string' && message.type !== 'ptt') {
            return
        }
        if (message.id.remote !== config.chatID) {
            if (message.body === '/setchat' && message.fromMe === true) {
                config.chatID = message.id.remote
                await saveJSON('./config.json', config)
                console.log('Chat ID set to:', message.id.remote)
            }
            return
        }

        if (message.fromMe === true && message.type !== 'ptt') {
            if (!message.body.startsWith('/')) {
                return
            }
        }

        let userMessage

        if (message.type === 'ptt') { // Handle voice messages
            userMessage = await processVoice(await message.downloadMedia())
            console.log('New voice message:', userMessage)
        } else {
            userMessage = message.body
            console.log('New message:', userMessage)
        }


        if (message.type !== 'ptt' && userMessage.startsWith('/')) {
            const parts = userMessage.split(' ')
            const command = parts[0]
            const argument = parts.slice(1).join(" ")
            

            switch (command) { // Commands that don't need arguments
                case '/listprompts':
                    client.sendMessage(config.chatID, 'Prompts:\n\n' + Object.keys(savedPrompts).join('\n'))
                    return
                
                case '/help':
                    client.sendMessage(config.chatID, `Commands:
/ask {message} (useful if you want to interact with the bot from the WhatsApp account it is hosted on)
/newprompt {prompt} (sets a new system prompt for the AI)
/addtoprompt {prompt} (adds more to existing system prompt)
/saveprompt {promptName} (saves system prompt to prompts.json so that it isn't lost after a restart)
/loadprompt {promptName} (loads system prompt from prompts.json, and sets it for the AI to use)
/deleteprompt {promptName} (deletes a system prompt saved in prompts.json)
/listprompts (lists all saved system prompts)
/setchat (changes the chat ID value in the config to the ID of the channel command is ran in)`)
                    return
                
                default:
                    const validCommands = ['/ask', '/newprompt', '/addtoprompt', '/saveprompt', '/loadprompt', '/deleteprompt']

                    if (!validCommands.includes(command)) {
                        client.sendMessage(config.chatID, 'Invalid command, run /help to see all commands')
                        return
                    }

                    if (!argument) {
                        client.sendMessage(config.chatID, 'No argument provided')
                        return
                    }


                    switch (command) { // Commands that need arguments
                        case '/ask':
                            const [textResponse, media] = await createResponse(argument)
                            await client.sendMessage(config.chatID, media, { caption: textResponse })
                            console.log('Reply sent')
                            return
        
                        case '/newprompt':
                            prompt = argument
                            context = resetContext(prompt)
                            client.sendMessage(config.chatID, 'Set new prompt')
                            return
        
                        case '/addtoprompt':
                            prompt = prompt + '\n' + argument
                            context = resetContext(prompt)
                            client.sendMessage(config.chatID, `Added ${argument} to prompt`)
                            return
        
                        case '/saveprompt':
                            if (savedPrompts[argument]) {
                                client.sendMessage(config.chatID, 'Prompt with this name already exists')
                                return
                            }
                            
                            savedPrompts[argument] = prompt
                            await saveJSON('./prompts.json', savedPrompts)
                            client.sendMessage(config.chatID, 'Saved prompt')
                            return
        
                        case '/loadprompt':
                            if (savedPrompts[argument.toLowerCase()]) {
                                prompt = savedPrompts[argument.toLowerCase()]
                                context = resetContext(prompt)
                                client.sendMessage(config.chatID, `Loaded prompt ${argument}`)
                            } else {
                                client.sendMessage(config.chatID, `Prompt ${argument} doesn't exist, run /listprompts to see all prompts`)
                            }
                            return
                        
                        case '/deleteprompt':
                            if (savedPrompts[argument]) {
                                delete savedPrompts[argument]
                                await saveJSON('./prompts.json', savedPrompts)
                                client.sendMessage(config.chatID, `Deleted prompt ${argument}`)
                            } else {
                                client.sendMessage(config.chatID, `Prompt ${argument} doesn't exist, run /listprompts to see all prompts`)
                            }
                            return
                    }
            }
            return
        }
        const [textResponse, media] = await createResponse(userMessage)

        await client.sendMessage(config.chatID, media, { caption: textResponse })

        console.log('Reply sent')
    } catch (error) {
        console.error('Error while sending reply', error)
    }
    
    
})

client.initialize();