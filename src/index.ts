import { BotCommand, MetaData, Option, ParserConfig } from './parser'
import { IopaBotContext, RouterApp } from 'iopa-types'

export const URN_BOTINTENT_LITERAL = 'urn:io.iopa.bot:intent:literal'

export class BotCommanderMiddleware {
    private app: RouterApp & { bot: BotCommand }

    constructor(app: RouterApp & { bot: BotCommand }) {
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
            context.botːIntent == 'urn:io.iopa.bot:intent:literal' &&
            context.botːText
        ) {
            await this.app.bot.parse(context.botːText, context)
            // never call next as we always complete inside the bot
        } else return next()
    }
}

export { BotCommand, MetaData, Option, ParserConfig }
