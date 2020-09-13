import { IopaBotContext, RouterApp } from 'iopa-types';
import { BotCommand, MetaData, Option, ParserConfig } from './parser';
export declare const URN_BOTINTENT_LITERAL = "urn:io.iopa.bot:intent:literal";
export declare class BotCommanderMiddleware {
    private app;
    constructor(app: RouterApp<{}, IopaBotContext> & {
        bot: BotCommand;
    });
    invoke(context: IopaBotContext, next: () => Promise<void>): Promise<void>;
}
export { BotCommand, MetaData, Option, ParserConfig };
