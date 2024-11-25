# whatsapp-bot
## You probably shouldn't use this, I just decided I wanted to make a repo for this
WhatsApp bot made using wweb.js that uses AI to respond to messages with text and image responses.

## Commands:
* `/ask {message}` (useful if you want to interact with the bot from the WhatsApp account it is hosted on)
* `/newprompt {prompt}` (sets a new system prompt for the AI)
* `/addtoprompt {prompt}` (adds more to existing system prompt)
* `/saveprompt {promptName}` (saves system prompt to prompts.json so that it isn't lost after a restart)
* `/loadprompt {promptName}` (loads system prompt from prompts.json, and sets it for the AI to use)
* `/deleteprompt {promptName}` (deletes a system prompt saved in prompts.json)
* `/listprompts` (lists all saved system prompts)
* `/addchat` (adds chat id of the chat to config)
* `/removechat` (removes chat id of the chat from config)
* `/refresh` (refreshes the config of the bot)

Currently cloudflare provides API access to AI models for free

## Usage

Install Node.JS on your computer: https://nodejs.org/en

Run `npm install && npm start`, it will automatically make the required config files.

Fill in config.json, don't touch prompts.json

For chat ID:
Leave it as it is (should be an empty array: `[]`), and when you have launched the bot run /addchat in the chat you want to use it in, or /removechat to remove the chat.
The bot does support responding in multiple chats, with seperate message contexts and prompts

To get an API key and account ID:

1. Create a cloudflare account.
2. On your dashboard, in the left sidebar navigate to AI > Workers AI
3. Click on "Use REST API"
4. Copy your account ID and put it in config.json
5. Click on "Create a Workers AI API Token"
6. Press "Create API Token"
7. Copy API Token into config

List of models you can use: https://developers.cloudflare.com/workers-ai/models/

Default prompt is just the system prompt it has at start

Message memory limit is how many previous message it will keep in its context

Finally, run: npm install && npm start