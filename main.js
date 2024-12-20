import whatsappWeb from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = whatsappWeb;
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import fs from 'fs/promises';
import chalk from 'chalk';


let startTimestamp

const log = console.log

function logSuccess(message, ...args) {
    console.log(chalk.green(message, ...args))
}
function logWarning(message, ...args) {
    console.log(chalk.hex('#FFA500')(message, ...args))
}
function logError(message, ...args) {
    console.log(chalk.bold.red(message, ...args))
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

    const validation = {
        str: ["workersApiKey", "workersAccountID", "textModel", "imageModel", "defaultPrompt"],
        int: ["messageMemoryLimit"],
        arr: ["chatID"]
    }

    let err

    Object.keys(validation).forEach(type => {
        validation[type].forEach(key => {
            if (!(key in config)) {
                logError(`Config is malformed, property ${key} is missing`)
            }
        })
    })

    validation.str.forEach(key => {
        if (typeof config[key] !== 'string' || config[key].length === 0) {
            logError(`Config is malformed, ${key} must be a non-empty string`)
            err = true
        }
    })
    validation.int.forEach(key => {
        if (typeof config[key] !== 'number') {
            logError(`Config is malformed, ${key} must be a number`)
            err = true
        }
    })
    validation.arr.forEach(key => {
        if (!Array.isArray(config[key])) {
            logError(`Config is malformed, ${key} must be an array`)
            err = true
        }
    })

    if (err) {
        process.exit(1)
    }
    return
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
        logSuccess('Successfully saved', file, data)
    } catch (err) {
        logError('Error saving file:', err)
        process.exit(1)
    }
}

async function apiRequest(endpoint, data) {
    try {
        const response = await axios.post(`https://api.cloudflare.com/client/v4/accounts/${config.workersAccountID}/ai/run/${endpoint}`,
            data,
            {headers: { Authorization: `Bearer ${config.workersApiKey}` }}
        )
        return response.data.result
    } catch (err) {
        logError(JSON.stringify(err.response.data.errors, null, 4))
        return null
    }
}

function resetContext(newPrompt) {
    return {
        messages: [
            { role: 'system', content: newPrompt }
        ]
    }
}

async function generateText(prompt, groupID) {
    const messageLimit = config.messageMemoryLimit * 2 + 1

    // Delete old messages past set memory limit
    if (context[groupID].messages.length >= messageLimit) {
        context[groupID].messages.splice(1, 2)
    }

    context[groupID].messages.push({"role": "user", "content": prompt})
    const result = await apiRequest(config.textModel, context[groupID])
    if (result) {
        const response = result.response
        context[groupID].messages.push({"role": "assistant", "content": response})
        return response
    }
    return null
}

async function summarizeForImageGen(prompt) {
    const result = await apiRequest(config.textModel, {
        "messages": [
            {"role": "system", "content": `
You are a concise and creative summarizer. Your task is to convert AI-generated text responses into prompts suitable for an image generation AI. 

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
Reply with ONLY the prompt
`},
            {"role": "user", "content": prompt}
        ]
    })

    return result?.response || null
}

async function generateImage(prompt) {
    const result = await apiRequest(config.imageModel, {prompt: prompt})
    return result?.image || null
}

async function processVoice(audio) {
    const decodedBase = Buffer.from(audio.data, 'base64')

    const result = await apiRequest('@cf/openai/whisper', decodedBase)

    return result?.text || null
}

async function createResponse(prompt, chatID) {

    let response = await generateText(prompt, chatID)
    if (!response) {
        return
    }
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

async function handleCommand(message, groupID) {
    const messageBody = message.body

    const parts = messageBody.split(' ')
    const command = parts[0]
    const argument = parts.slice(1).join(" ")
    

    switch (command) { // Commands that don't need arguments
        case '/refresh':
            if (!message.fromMe) {
                return
            }
            await initializeConfig()

            prompt = config.defaultPrompt
            context = resetContext(prompt)

            logSuccess('Refreshed config')
            return
        case '/listprompts':
            await message.reply('Prompts:\n\n' + Object.keys(savedPrompts).join('\n'))
            return
        
        case '/help':
            await message.reply(`Commands:
/ask {message} (useful if you want to interact with the bot from the WhatsApp account it is hosted on)
/newprompt {prompt} (sets a new system prompt for the AI)
/addtoprompt {prompt} (adds more to existing system prompt)
/saveprompt {promptName} (saves system prompt to prompts.json so that it isn't lost after a restart)
/loadprompt {promptName} (loads system prompt from prompts.json, and sets it for the AI to use)
/deleteprompt {promptName} (deletes a system prompt saved in prompts.json)
/listprompts (lists all saved system prompts)
/addchat (makes bot respond to messages in the chat that the command is ran in)
/removechat (removes chat from list of chats where bot responds to messages)
/refresh (refreshes the config of the bot)`)
            return
        
        default:
            const validCommands = ['/ask', '/newprompt', '/addtoprompt', '/saveprompt', '/loadprompt', '/deleteprompt']

            if (!validCommands.includes(command)) {
                await message.reply('Invalid command, run /help to see all commands')
                return
            }

            if (!argument) {
                await message.reply('No argument provided')
                return
            }


            switch (command) { // Commands that need arguments
                case '/ask':
                    const [textResponse, media] = await createResponse(argument, groupID)
                    if (!media) {
                        await client.sendMessage(groupID, textResponse)
                    } else {
                        await client.sendMessage(groupID, media, { caption: textResponse })
                    }
                    log('Reply sent')
                    return

                case '/newprompt':
                    prompt = argument
                    context[groupID] = resetContext(prompt)
                    await message.reply('Set new prompt')
                    return

                case '/addtoprompt':
                    prompt = prompt + '\n' + argument
                    context[groupID] = resetContext(prompt)
                    await message.reply(`Added ${argument} to prompt`)
                    return

                case '/saveprompt':
                    if (savedPrompts[argument.toLowerCase()]) {
                        await message.reply('Prompt with this name already exists')
                        return
                    }
                    
                    savedPrompts[argument.toLowerCase()] = prompt
                    await saveJSON('./prompts.json', savedPrompts)
                    await message.reply('Saved prompt', argument.toLowerCase())
                    return

                case '/loadprompt':
                    if (savedPrompts[argument.toLowerCase()]) {
                        prompt = savedPrompts[argument.toLowerCase()]
                        context[groupID] = resetContext(prompt)
                        await message.reply(`Loaded prompt ${argument.toLowerCase()}`)
                    } else {
                        await message.reply(`Prompt ${argument.toLowerCase()} doesn't exist, run /listprompts to see all prompts`)
                    }
                    return
                
                case '/deleteprompt':
                    if (savedPrompts[argument]) {
                        delete savedPrompts[argument]
                        await saveJSON('./prompts.json', savedPrompts)
                        await message.reply(`Deleted prompt ${argument}`)
                    } else {
                        await message.reply(`Prompt ${argument} doesn't exist, run /listprompts to see all prompts`)
                    }
                    return
            }
    }
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.once('ready', () => {
    startTimestamp = Math.floor(Date.now() / 1000)
    logSuccess('Started listening for messages')
    if (config.chatID.length === 0) {
        logWarning('No chats set, bot will not respond to any messages until you run /addchat in a chat.')
    }
})

client.on('qr', qr => {
    log('Scan in WhatsApp to log in')
    qrcode.generate(qr, {small: true})
})

client.on('message_create', async message => {
    try {
        // Do not respond to old messages
        if (message.timestamp < startTimestamp) {
            return
        }

        if (typeof message.body !== 'string' && message.type !== 'ptt') {
            return
        }

        const group = await message.getChat()
        const groupID = group.id._serialized

        if (!config.chatID.includes(groupID)) {
            if (message.body === '/addchat' && message.fromMe === true) {
                config.chatID.push(groupID)

                await saveJSON('./config.json', config)

                context[groupID] = resetContext(prompt)
                logSuccess('Chat ID added:', groupID)
                return
            }
            return
        } else if (message.body === '/removechat' && message.fromMe === true) {
            config.chatID.splice(config.chatID.indexOf(groupID), 1)
            await saveJSON('./config.json', config)

            delete context[groupID]

            logSuccess(`Chat ${groupID} has been removed`)
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


        if (userMessage.startsWith('/')) {
            await handleCommand(message, groupID)
            return
        }

        const [textResponse, media] = await createResponse(userMessage, groupID)

        if (!media) {
            await client.sendMessage(groupID, textResponse)
        } else {
            await client.sendMessage(groupID, media, { caption: textResponse })
        }

        

        log('Reply sent')
    } catch (err) {
        logError('Error while sending reply', err)
    }
    
    
})

await initializeConfig()

let prompt = config.defaultPrompt

let context = {}

config.chatID.forEach(key => {
    context[key] = resetContext(prompt)
})



log(context)

client.initialize();