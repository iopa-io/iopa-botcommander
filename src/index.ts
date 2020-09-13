import { IopaBotContext, RouterApp } from 'iopa-types'
import { BotCommand, MetaData, Option, ParserConfig } from './parser'

export const URN_BOTINTENT_LITERAL = 'urn:io.iopa.bot:intent:literal'

export class BotCommanderMiddleware {
    private app: RouterApp<{}, IopaBotContext> & { bot: BotCommand }

    constructor(app: RouterApp<{}, IopaBotContext> & { bot: BotCommand }) {
        this.app = app

        app.bot = new BotCommand()

        app.bot.configSetSend(async (context: IopaBotContext, msg: any) => {
            await context.response.send(msg)
        })
    }

    async invoke(
        context: IopaBotContext,
        next: () => Promise<void>
    ): Promise<void> {
        if (
            context['bot.Intent'] === 'urn:io.iopa.bot:intent:literal' &&
            context['bot.Text']
        ) {
            await this.app.bot.parse(context['bot.Text'], context)
            // never call next as we always complete inside the bot
        } else {
            await next()
        }
    }
}

export { BotCommand, MetaData, Option, ParserConfig }
