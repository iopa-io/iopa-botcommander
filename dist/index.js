import { BotCommand, Option } from './parser';
export const URN_BOTINTENT_LITERAL = 'urn:io.iopa.bot:intent:literal';
export class BotCommanderMiddleware {
    constructor(app) {
        this.app = app;
        app.bot = new BotCommand();
        app.bot.configSetSend(async (context, msg) => {
            await context.response.send(msg);
        });
    }
    async invoke(context, next) {
        if (context['bot.Intent'] === 'urn:io.iopa.bot:intent:literal' &&
            context['bot.Text']) {
            await this.app.bot.parse(context['bot.Text'], context);
        }
        else {
            await next();
        }
    }
}
export { BotCommand, Option };
//# sourceMappingURL=index.js.map