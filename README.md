# whatsapp-bot
## You probably shouldn't use this, I just decided I wanted to make a repo for this
WhatsApp bot made using wweb.js that uses AI to respond to messages with text and image responses.

## Commands:
* `/ask {message}` (useful if you want to interact with the bot from the WhatsApp account it is hosted on)
* `/newprompt {prompt}` (sets a new prompt for the AI)
* `/saveprompt {promptName}` (saves prompt to a JSON file so that it isn't lost after a restart)
* `/loadprompt {promptName}` (loads prompt from JSON file, and sets it for the AI to use)
* `/listprompts` (lists all saved prompts)
* `/setchat` (changes the chat ID value in the config to the ID of the channel command is ran in)

Currently cloudflare provides access to the AI models for free

## Usage

Install Node.JS on your computer: https://nodejs.org/en

Create a config.json file and fill it following the example in config.example.json

To get a chat ID:

If you don't know how to find one, when you have started the bot, run /setchat in the chat you want to use the bot in

To get an api key and account id:

1. Create a cloudflare account.
2. On your dashboard, in the left sidebar navigate to AI > Workers AI
3. Click on "Use REST API"
4. Copy your account ID and put it in config.json
5. Click on "Create a Workers AI API Token"
6. Press "Create API Token"
7. Copy API Token into config

List of models you can use: https://developers.cloudflare.com/workers-ai/models/

Then, run the following in your terminal: npm install && npm start

