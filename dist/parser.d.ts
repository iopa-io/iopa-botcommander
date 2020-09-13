export declare const EventEmitter: typeof import("iopa/src/util/events").EventEmitter;
export interface MetaData {
    context: any;
    resolve: Function;
    reject: Function;
}
interface CommandConfig {
    noHelp?: boolean;
}
declare type DataValues = {
    [key: string]: string;
};
declare type Message = any;
export interface ParserConfig {
    send: (context: any, msg: Message) => Promise<void>;
    allowUnknownOption: boolean;
    showHelpOnError: boolean;
    lowerCase: boolean;
    showHelpOnEmpty: boolean;
}
export declare class Option {
    flags: string;
    required: boolean;
    optional: boolean;
    bool: boolean;
    short?: string;
    negate: boolean;
    long: string;
    description: string;
    defaultValue: any;
    parseValue: Function;
    constructor(flags: string, description?: string);
    name(): string;
    attributeName(): any;
    is(arg: any): boolean;
}
export declare class BotCommand extends EventEmitter {
    private _name;
    private _alias;
    private _description;
    private _argsDescription;
    private _usage;
    private _noHelp;
    private _prefixes;
    private _cmdArgs;
    private _cmdOptions;
    private _commands;
    private _parent;
    private _helpFlags;
    private _helpDescription;
    private _helpShortFlag;
    private _helpLongFlag;
    private parserConfig;
    constructor(name?: string);
    command(nameAndArgs: string, config?: CommandConfig): BotCommand;
    setParserConfig(parserConfig: any): void;
    arguments(desc: string): BotCommand;
    private addImplicitHelpCommand;
    private parseExpectedArgs;
    action(fn: (context: any, data: any) => void): BotCommand;
    api(fn: (context: any, data: any) => void): BotCommand;
    invoke(name: string, context: any, data: any): Promise<void>;
    option(flags: string, description?: string, defaultValue?: any): BotCommand;
    configAllowUnknownOption(arg?: boolean): this;
    configSetSend(cb: (context: any, msg: Message) => Promise<void>): this;
    configShowHelpOnError(arg?: boolean): this;
    configShowHelpOnEmpty(arg?: boolean): this;
    configPrefix(prefix: string | string[]): this;
    parse(line: string, context: any): Promise<void>;
    private parseLine;
    private parseCommand;
    private normalize;
    private cmdOptionFor;
    cmdOptionsObject(prevData: DataValues, data: DataValues): DataValues;
    private missingArgument;
    private optionMissingArgument;
    private unknownOption;
    private variadicArgNotLast;
    get meta(): any;
    description(str: string, argsDescription?: {
        [argName: string]: string;
    }): BotCommand;
    alias(alias: string): BotCommand;
    usage(str: string): BotCommand;
    name(str: string): BotCommand;
    private prepareCommands;
    private largestCommandLength;
    private largestOptionLength;
    private largestArgLength;
    private padWidth;
    private optionHelp;
    private commandHelp;
    private helpInformation;
    send(metadata: MetaData, msg: Message): Promise<void>;
    outputHelp(metadata: MetaData): Promise<void>;
    helpOption(flags?: string, description?: string): BotCommand;
    private _checkShowHelp;
    private outputHelpIfNecessary;
}
export {};
