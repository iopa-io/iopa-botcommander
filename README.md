# [![IOPA](https://iopa.io/iopa.png)](https://iopa.io)<br> iopa-botcommander

[![NPM](https://img.shields.io/badge/iopa-certified-99cc33.svg?style=flat-square)](https://iopa.io/)
[![NPM](https://img.shields.io/badge/iopa-bot%20framework-F67482.svg?style=flat-square)](https://iopa.io/)

[![NPM](https://nodei.co/npm/iopa-botcommander.png?downloads=true)](https://nodei.co/npm/iopa-botcommander/)

## About

This repository contains a simple text line parser based on TJ's commander.js but adapted for a headless, serverless environment with text only parsing, asynchronous replies, and no console.

No dependencies, pure javascript runs on node, in the browser and in service workers.

## Changes from prior art

TypeScript library for parsing commands from interactive interfaces (bot chats)

-   Based on and inspired by [tj/commander.js] and [friscoMad/botCommander]
-   (1) Added async functionality for embedding within iopa-bot or Microsoft botbuilder frameworks:
    Resolves promise once command has been actioned (or help/error displayed)
-   (2) Updated to tj/commander V3 without version functionality
-   (3) Added bot.apicommand and bot.parseapi methods

## Usage (standalone)

You can use the one file parser in any framework of your choosing. For example in Microsoft's Botbuilder
framework it might be used as follows:

```ts

import { BotCommander } from 'iopa-botcommander'

function oneTimeInit() {

       // Create a new BotCommnader
       const bot = new BotCommand()

       // Set up the default send function for help and errors
       bot.configSetSend((turnContext, msg) =>
               turnContext.sendActivity(msg)
       )

       // Add a command
       bot
       .command('order <product> <price>')
       .action(async (turnContext, data) => {
       await turnContext.sendActivity(`Ok, ordering ${data.product} at price ${data.price}`)
       }
}

// Then when we get a message
 this.onMessage(async (turnContext, next) => {
       bot.parse(turnContext.activity.text, turnContext)
 }
```

With this in place you can enter

```bash
> bot help
> bot order pizza $10.50
```

## Usage (as IOPA middleware)

```ts

        import { BotCommanderMiddleware, BotCommand } from 'iopa-botcommander'

        import { App, Context } from 'iopa'

        const app: App && { bot: BotCommand } = new App()

        app.use(BotCommanderMiddleware, 'BotCommanderMiddleware')

        app.bot
                .command('order <product> <price>')
                .action(async (context: Context, data: {product: string, price: string}) => {
                await context.response.send(`Ok, ordering ${data.product} at price ${data.price}`)
                })

        app.build()

        // Not shown:  Hook up app to your favorite serverless and slack/msteams environment
```

## License

MIT

## Prior Art

[https://github.com/tj/commander.js](https://github.com/tj/commander.js)


## API Reference Specification

[![IOPA](https://iopa.io/iopa.png)](https://iopa.io)
