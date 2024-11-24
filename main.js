import whatsappWeb from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = whatsappWeb;
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import fs from 'fs/promises';
import chalk from 'chalk';


const log = console.log

function logSuccess(message) {
    console.log(chalk.green(message))
}
function logWarning(message) {
    console.log(chalk.hex('#FFA500')(message))
}
function logError(message) {
    console.log(chalk.bold.red(message))
}

let savedPrompts
let config

async function initializeConfig() {
    try { // Load prompts.json
        savedPrompts = await readJSON('./prompts.json')
    } catch (err) {
        if (err.code === 'ENOENT') { // If prompts.json doesn't exist
            logWarning('prompts.json not found, creating')
            await fs.writeFile('./prompts.json', '{}', { flag: 'w' })
            savedPrompts = {}
            logSuccess('Created prompts.json')
        } else {
            logError('Error reading prompts.json:', err)
            process.exit(1)
        }
    }
    
    try { // Load config.json
        config = await readJSON('./config.json')
    } catch (err) {
        if (err.code === 'ENOENT') { // If config.json doesn't exist
            logWarning('config.json not found, creating')
            const configExample = await fs.readFile('./config.example.json')
            await fs.writeFile('./config.json', configExample, { flag: 'w' })
            logSuccess('Created config.json, please fill it out before relaunching')
            process.exit(0)
        } else {
            logError('Error reading config.json', err)
            process.exit(1)
        }
    }
}


async function readJSON(file) {
    const data = await fs.readFile(file);
    return JSON.parse(data);
}

async function saveJSON(file, data) {
    try {
        if (typeof data === 'object') {
            data = JSON.stringify(data, null, 4);
        }
    
        await fs.writeFile(file, data)
        logSuccess('Successfully saved', file)
    } catch (err) {
        logError('Error saving file:', err)
        process.exit(1)
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
        const messageLimit = config.messageMemoryLimit * 2 + 1 // User message and bot response are considered 1 message, so we multiply by 2, and + 1 is for the system prompt

        if (context.messages.length >= messageLimit) { // Delete old messages in memory
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
    } catch (err) {
        logError('Error while generating response', err)
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
    try {
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
    } catch (err) {
        logError(err)
        return undefined
    }
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

    log("Generated response:", response)

    const imagePrompt = await summarizeForImageGen(response)

    const image = await generateImage(imagePrompt)

    let media

    if (!image) {
        logWarning('There was an error generating an image, sending without image')
        media = undefined
    } else {
        log("Generated image using prompt:", imagePrompt)
        media = new MessageMedia('image/jpeg', image)
    }

    
    return [response, media]
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.once('ready', () => {
    logSuccess('Started listening for messages')
    if (!config.chatID) {
        logWarning('Chat ID is not set, bot will not respond to any messages until you specify a chat. This can be done by setting it in the config file, or automatically by running /setchat in your chosen channel.')
    }
})

client.on('qr', qr => {
    log('Scan in WhatsApp to log in')
    qrcode.generate(qr, {small: true})
})

client.on('message_create', async message => {
    try {
        if (typeof message.body !== 'string' && message.type !== 'ptt') {
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
            log('New voice message:', userMessage)
        } else {
            userMessage = message.body
            log('New message:', userMessage)
        }


        if (message.type !== 'ptt' && userMessage.startsWith('/')) {
            const parts = userMessage.split(' ')
            const command = parts[0]
            const argument = parts.slice(1).join(" ")
            

            switch (command) { // Commands that don't need arguments
                case `/setchat`:
                    if (!message.fromMe) {
                        return
                    }
                    config.chatID = message.id.remote
                    await saveJSON('./config.json', config)
                    logSuccess('Chat ID set to:', message.id.remote)
                    return
                case '/refresh':
                    if (!message.fromMe) {
                        return
                    }
                    await initializeConfig()
                    logSuccess('Refreshed config')
                    return
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
/setchat (changes the chat ID value in the config to the ID of the channel command is ran in)
/refresh (refreshes the config of the bot)`)
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
                            if (!media) {
                                await client.sendMessage(config.chatID, textResponse)
                            } else {
                                await client.sendMessage(config.chatID, media, { caption: textResponse })
                            }
                            log('Reply sent')
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

        if (!media) {
            await client.sendMessage(config.chatID, textResponse)
        } else {
            await client.sendMessage(config.chatID, media, { caption: textResponse })
        }

        

        log('Reply sent')
    } catch (err) {
        logError('Error while sending reply', err)
    }
    
    
})

await initializeConfig()

let prompt = config.defaultPrompt

let context = {
    "messages": [
        {"role": "system", "content": prompt}
    ]
}

client.initialize();