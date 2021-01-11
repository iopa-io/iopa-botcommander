/* eslint-disable no-cond-assign */
/* eslint-disable no-bitwise */
/* eslint-disable prefer-destructuring */
/* eslint-disable no-continue */
/* eslint-disable no-async-promise-executor */
/**
 * BOT COMMANDER ASYNC
 *
 * TypeScript library for parsing commands from interactive interfaces (bot chats)
 * Based on and inspired by [tj/commander.js] and [friscoMad/botCommander]
 *
 * (1) Added async functionality for embedding within iopa-bot or Microsoft botbuilder frameworks:
 *        Resolves promise once command has been actioned (or help/error displayed)
 * (2) Updated to tj/commander V3 without version functionality
 * (3) Added bot.apicommand and bot.parseapi methods
 *
 * LICENSE AND COPYRIGHT FOR THIS FILE ONLY:  MIT
 *
 * Copyright (c) Offgrid Networks 2019
 * Portions Copyright (c) 2011 TJ Holowaychuk <tj@vision-media.ca>
 * Portions Copyright (c) 2017 Ramiro Aparicio rapariciog@gmail.com
 *
 */

import { util } from 'iopa'

export const { EventEmitter } = util

export interface MetaData {
    context: any
    resolve: Function
    reject: Function
}

interface ArgDetails {
    required: boolean
    name: string
    variadic: boolean
}

interface CommandConfig {
    noHelp?: boolean
}

type DataValues = { [key: string]: string }

interface ParsedResult {
    line: string
    rawArgs: string[]
    args: string[]
    data: DataValues
    unknown: string[]
    errors: string[]
}

type Message = any

export interface ParserConfig {
    send: (context: any, msg: Message) => Promise<void>
    allowUnknownOption: boolean
    showHelpOnError: boolean
    lowerCase: boolean
    showHelpOnEmpty: boolean
}

export class Option {
    flags: string

    required: boolean

    optional: boolean

    bool: boolean

    short?: string

    negate: boolean

    long: string

    description: string

    defaultValue: any

    parseValue: Function

    /** Initialize a new `Option` with the given `flags` and `description` */
    constructor(flags: string, description?: string) {
        this.flags = flags
        this.required = flags.indexOf('<') >= 0
        this.optional = flags.indexOf('[') >= 0
        this.negate = flags.indexOf('-no-') !== -1
        const flagsArray = flags.split(/[ ,|]+/)
        if (flagsArray.length > 1 && !/^[[<]/.test(flagsArray[1])) {
            this.short = flagsArray.shift()
        }
        this.long = flagsArray.shift()
        this.description = description || ''
        this.parseValue = (arg) => arg
    }

    /** Initialize a new `Option` with the given `flags` and `description` */
    name() {
        return this.long.replace(/^--/, '')
    }

    /**
     * Return option name, in a camelcase format that can be used
     * as a object attribute key.
     */
    public attributeName() {
        return camelcase(this.name().replace(/^no-/, ''))
    }

    /** Check if `arg` matches the short or long flag  */
    public is(arg) {
        return this.short === arg || this.long === arg
    }
}

export class BotCommand extends EventEmitter {
    //
    // Command Meta Data
    //

    private _name: string

    private _alias: string = null

    private _description: string

    private _argsDescription: { [argName: string]: string }

    private _usage: string

    private _noHelp = false

    private _prefixes: string[] = null

    //
    // Command definition (arguments and options)
    //

    private _cmdArgs: ArgDetails[] = []

    private _cmdOptions: Option[] = []

    //
    // Command hierarchy (children and parent)

    private _commands: BotCommand[] = []

    private _parent: this

    //
    // Help flags
    //
    private _helpFlags = '-h, --help'

    private _helpDescription = 'output usage information'

    private _helpShortFlag = '-h'

    private _helpLongFlag = '--help'

    //
    // Overall parser configurgation (for this command and subsequent)
    //
    private parserConfig: ParserConfig = {
        send: null as (context: any, msg: Message) => Promise<void>,
        allowUnknownOption: false,
        showHelpOnError: true,
        lowerCase: false,
        showHelpOnEmpty: false,
    }

    //
    // CONSTRUCTOR
    //

    constructor(name?: string) {
        super()
        this._name = name || ''
    }

    /** Initialize a new `BotCommand` */
    public command(
        nameAndArgs: string,
        config: CommandConfig = {}
    ): BotCommand {
        const args = nameAndArgs.split(/ +/)
        const cmd = new BotCommand(args.shift())
        cmd.setParserConfig(this.parserConfig)
        cmd._noHelp = !!config.noHelp
        cmd._helpFlags = this._helpFlags
        cmd._helpDescription = this._helpDescription
        cmd._helpShortFlag = this._helpShortFlag
        cmd._helpLongFlag = this._helpLongFlag
        this._commands.push(cmd)
        cmd.parseExpectedArgs(args)
        cmd._parent = this

        if (this._commands.length === 1 && args[0] !== 'help') {
            this.addImplicitHelpCommand()
        }

        return cmd
    }

    //
    // PUBLIC METHODS
    //

    /** Overwrite all parse options for a command and the subcommands created afterwards */
    public setParserConfig(parserConfig) {
        this.parserConfig = parserConfig
    }

    /** Define argument syntax for the top-level command */
    public arguments(desc: string): BotCommand {
        return this.parseExpectedArgs(desc.split(/ +/))
    }

    /** Add an implicit `help [cmd]` subcommand which invokes `--help` for the given command. */
    private addImplicitHelpCommand() {
        this.command('help [cmd]').description('display help for [cmd]')
    }

    /** Parse expected `args`.  For example `["[type]"]` becomes `[{ required: false, name: 'type' }]`. */
    private parseExpectedArgs(args: string[]): BotCommand {
        if (!args.length) {
            return this
        }
        args.forEach((arg) => {
            const argDetails: ArgDetails = {
                required: false,
                name: '',
                variadic: false,
            }

            switch (arg[0]) {
                case '<':
                    argDetails.required = true
                    argDetails.name = arg.slice(1, -1)
                    break
                case '[':
                    argDetails.name = arg.slice(1, -1)
                    break
                default:
                /** noop */
            }

            if (
                argDetails.name.length > 3 &&
                argDetails.name.slice(-3) === '...'
            ) {
                argDetails.variadic = true
                argDetails.name = argDetails.name.slice(0, -3)
            }
            if (argDetails.name) {
                this._cmdArgs.push(argDetails)
            }
        })
        return this
    }

    /** Register callback `fn` for the command */
    public action(fn: (context: any, data: any) => void): BotCommand {
        const listener = async (
            prevParsed: ParsedResult,
            metadata: MetaData
        ) => {
            let args = prevParsed.args || []

            const parsed = this.parseLine((prevParsed.unknown || []).join(' '))

            if (parsed.errors.length > 0) {
                this._checkShowHelp(parsed.errors)
                await this.send(metadata, parsed.errors.join('\n'))
                return
            }

            const helptext = this.outputHelpIfNecessary(parsed.unknown)

            if (helptext) {
                await this.send(metadata, helptext)
                return
            }

            if (
                parsed.unknown.length > 0 &&
                !this.parserConfig.allowUnknownOption
            ) {
                const msg = []
                msg.push(this.unknownOption(parsed.unknown[0]))
                this._checkShowHelp(msg)
                await this.send(metadata, msg.join('\n'))
                return
            }

            args = prevParsed.args.concat(parsed.args)
            const data = this.cmdOptionsObject(prevParsed.data, parsed.data)

            const errors = []
            this._cmdArgs.forEach((arg, i) => {
                if (args[i] && args[i].match(/["'].+["']/)) {
                    data[arg.name] = args[i].substring(1, args[i].length - 1)
                } else if (args[i] && args[i].startsWith('@')) {
                    data[arg.name] = args[i].substring(1)
                } else {
                    data[arg.name] = args[i] || null
                }
                if (arg.required && args[i] == null) {
                    errors.push(this.missingArgument(arg.name))
                } else if (arg.variadic) {
                    if (i !== this._cmdArgs.length - 1) {
                        errors.push(this.variadicArgNotLast(arg.name))
                    }
                    data[arg.name] = args.splice(i) as any
                }
            })
            if (errors.length > 0) {
                this._checkShowHelp(errors)
                await this.send(metadata, errors.join('\n'))
                return
            }
            data.raw = prevParsed.line
            try {
                await fn.call(this, metadata.context, data)
            } catch (ex) {
                console.error(ex)
                await this.send(
                    metadata,
                    `${ex.statusText || ex.message || ex.toString()}`
                )
            }
            metadata.resolve()
        }

        const parent = this._parent || this
        const name = parent === this ? '*' : this._name
        this.on(`command:${name}`, listener)
        if (this._alias) {
            this.on(`command:${this._alias}`, listener)
        }
        return this
    }

    /** Register callback `fn` for the api */
    public api(fn: (context: any, data: any) => void): BotCommand {
        const parent = this._parent || this
        const name = parent === this ? '*' : this._name

        this._noHelp = true

        const listener = async (metadata: MetaData, data: any) => {
            await fn.call(this, metadata.context, data)
            metadata.resolve()
        }

        this._parent.on(`api:${name}`, listener)
        if (this._alias) {
            parent.on(`api:${this._alias}`, listener)
        }

        return this
    }

    /** Register callback `fn` for the api */
    public async invoke(name: string, context: any, data: any): Promise<void> {
        let metadata: MetaData

        await new Promise((resolve, reject) => {
            metadata = { context, resolve, reject }

            const command = this._commands.find(
                (cmd) => cmd._name === name || cmd._alias === name
            )

            if (command) {
                this.emit(`api:${name}`, metadata, data)
            } else {
                resolve(null)
            }
        })

        context.log('botcommander action  complete')

        metadata = null
    }

    /** Define option with `flags`, `description` and optional coercion `fn`.
     *
     * The `flags` string should contain both the short and long flags,
     * separated by comma, a pipe or space. The following are all valid
     * all will output this way when `--help` is used.
     *
     *    "-p, --pepper"
     *    "-p|--pepper"
     *    "-p --pepper"
     *
     * Examples:
     *
     *     // simple boolean defaulting to undefined
     *     bot.option('-p, --pepper', 'add pepper');
     *
     *     bot.pepper
     *     // => undefined
     *
     *     --pepper
     *     bot.pepper
     *     // => true
     *
     *     // simple boolean defaulting to true (unless non-negated option is also defined)
     *     bot.option('-C, --no-cheese', 'remove cheese');
     *
     *     bot.cheese
     *     // => true
     *
     *     --no-cheese
     *     bot.cheese
     *     // => false
     *
     *     // required argument
     *     bot.option('-C, --chdir <path>', 'change the working directory');
     *
     *     --chdir /tmp
     *     bot.chdir
     *     // => "/tmp"
     *
     *     // optional argument
     *     bot.option('-c, --cheese [type]', 'add cheese [marble]');
     *
     */
    public option(
        flags: string,
        description?: string,
        defaultValue?: any
    ): BotCommand

    public option(
        flags: string,
        description?: string,
        fn?: ((arg1: any, arg2: any) => void) | RegExp,
        defaultValue?: any
    ): BotCommand {
        const option = new Option(flags, description)
        const oname = option.name()
        const name = option.attributeName()

        // default as 3rd arg
        if (typeof fn !== 'function') {
            if (fn instanceof RegExp) {
                // This is a bit simplistic (especially no error messages), and probably better handled by caller using custom option processing.
                // No longer documented in README, but still present for backwards compatibility.
                const regex = fn
                fn = (val, def) => {
                    const m = regex.exec(val)
                    return m ? m[0] : def
                }
            } else {
                defaultValue = fn
                fn = null
            }
        }

        if (
            option.negate ||
            option.optional ||
            option.required ||
            typeof defaultValue === 'boolean'
        ) {
            if (option.negate) {
                const opts = this.cmdOptionsObject({}, {})
                defaultValue = Object.prototype.hasOwnProperty.call(opts, name)
                    ? opts[name]
                    : true
            }
            if (defaultValue !== undefined) {
                this[name] = defaultValue
                option.defaultValue = defaultValue
            }
        }

        this._cmdOptions.push(option)

        this.on(`option:${oname}`, (val) => {
            if (val !== null && fn) {
                val = (fn as Function)(
                    val,
                    this[name] === undefined ? defaultValue : this[name]
                )
            }

            if (
                typeof this[name] === 'boolean' ||
                typeof this[name] === 'undefined'
            ) {
                if (val == null) {
                    this[name] = option.negate ? false : defaultValue || true
                } else {
                    this[name] = val
                }
            } else if (val !== null) {
                this[name] = option.negate ? false : val
            }
        })

        return this
    }

    /**
     * Allow unknown _cmdOptions on the command line.
     */
    public configAllowUnknownOption(arg = true) {
        this.parserConfig.allowUnknownOption = arg
        return this
    }

    /**  Configure output function for errors */
    public configSetSend(cb: (context: any, msg: Message) => Promise<void>) {
        this.parserConfig.send = cb
        return this
    }

    /**  Show full command help when an error occurs */
    public configShowHelpOnError(arg = true) {
        this.parserConfig.showHelpOnError = arg
        return this
    }

    /** Show full command help when no command is found */
    public configShowHelpOnEmpty(arg = true) {
        this.parserConfig.showHelpOnEmpty = arg
        return this
    }

    /**
     * Sets the prefix to search when parsing a line of text, this option is not inherited by subcommands otherwise it would
     * require double prefix for subcomands something like !command !subcommad
     */
    public configPrefix(prefix: string | string[]) {
        if (typeof prefix === 'string') {
            this._prefixes = [prefix]
        } else {
            this._prefixes = prefix
        }
        return this
    }

    /**
     * Parse line of text, settings _cmdOptions and invoking commands actions when defined.
     * If there is no command defined in the line or there is some error the help will be sent.
     */
    public async parse(line: string, context: any): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const metadata: MetaData = { context, resolve, reject }

            if (this._prefixes) {
                const prefixFound = this._prefixes.find((prefix) =>
                    line.startsWith(prefix)
                )
                if (prefixFound == null) {
                    resolve() // or reject?
                    return
                }
                line = line.substring(prefixFound.length)
            }

            const parsed: ParsedResult = this.parseLine(line)

            if (parsed.errors.length > 0) {
                this._checkShowHelp(parsed.errors)
                this.send(metadata, parsed.errors.join('\n'))
                return
            }

            delete parsed.errors

            this.parseCommand(parsed, metadata)
        })
    }

    /** Parse _cmdOptions from `argv` returning `argv`  void of these _cmdOptions  */
    private parseLine(line: string, prevResult?: ParsedResult): ParsedResult {
        const rawArgs = line
            .split(/(".+?")|('.+?')|\s+/g)
            .filter((a) => a && a.length > 0)

        const argv = this.normalize(rawArgs)
        const args: string[] = []

        const errors: string[] = []
        const data: DataValues = prevResult ? prevResult.data : {}
        const len = argv.length
        let literal
        let option
        let arg

        const unknownOptions = []

        for (let i = 0; i < len; ++i) {
            arg = argv[i]

            if (literal) {
                args.push(arg)
                continue
            }

            if (arg === '--') {
                literal = true
                continue
            }

            option = this.cmdOptionFor(arg)

            if (option) {
                const name = option.name()
                if (option.required) {
                    arg = argv[++i]
                    if (arg == null) {
                        errors.push(this.optionMissingArgument(option))
                    } else {
                        this.emit(`option:${name}`, arg)
                    }
                    data[name] = option.parseValue(arg, data[name])
                } else if (option.optional) {
                    arg = argv[i + 1]
                    if (arg == null || (arg[0] === '-' && arg !== '-')) {
                        arg = null
                    } else {
                        ++i
                    }
                    data[name] = option.parseValue(arg, data[name])
                    this.emit(`option:${option.name()}`, arg)
                } else {
                    data[name] = option.parseValue(null, data[name])
                    this.emit(`option:${option.name()}`)
                }
                continue
            }

            if (arg.length > 1 && arg[0] === '-') {
                unknownOptions.push(arg)
                if (
                    i + 1 < argv.length &&
                    (argv[i + 1][0] !== '-' || argv[i + 1] === '-')
                ) {
                    unknownOptions.push(argv[++i])
                }
                continue
            }

            args.push(arg)
        }

        return {
            line: prevResult ? prevResult.line : line,
            args,
            data,
            rawArgs: prevResult ? prevResult.rawArgs : rawArgs,
            unknown: unknownOptions,
            errors,
        }
    }

    /**
     * Parse command `args`.
     *
     * If help it is requested or there is no argument to parse sends help, otherwise tries to invoke listener(s) when available, then it
     * checks if a subcommand is the first arg and delegates the parsing to that subcomand, otherwise the "*"
     * event is emitted and those actions are invoked.
     */
    private async parseCommand(
        parsed: ParsedResult,
        metadata: MetaData
    ): Promise<void> {
        const { args } = parsed
        let name
        if (args.length && args[0] !== '') {
            name = args[0]
            if (this.parserConfig.lowerCase) {
                name = name.toLowerCase()
            }
            if (name === 'help' && args.length === 1) {
                this.outputHelp(metadata)
                return
            }
            if (name === 'help') {
                args.shift()
                name = args[0]
                parsed.unknown.push('--help')
                parsed.rawArgs = parsed.rawArgs.slice(1)
                parsed.rawArgs.push('--help')
            }
            if (this.listeners.has(`command:${name}`)) {
                args.shift()
                this.emit(`command:${name}`, parsed, metadata)
            } else {
                const command = this._commands.find(
                    (cmd) => cmd._name === name || cmd._alias === name
                )
                if (command) {
                    const line = parsed.rawArgs.slice(1).join(' ')
                    const newResult = command.parseLine(line, parsed)
                    command.emit(`command:${name}`, newResult, metadata)
                } else {
                    this.emit('command:*', parsed, metadata)
                }
            }
        } else if (this.parserConfig.showHelpOnEmpty) {
            const helptext = this.outputHelpIfNecessary(parsed.unknown)
            if (helptext) {
                await this.send(metadata, helptext)
            }
        }
    }

    /** Normalize `args`, splitting joined short flags   */
    private normalize(args: string[]) {
        let ret: string[] = []
        let arg: string
        let lastOpt: Option
        let index: number
        let short: string
        let opt: Option

        for (let i = 0, len = args.length; i < len; ++i) {
            arg = args[i]
            if (i > 0) {
                lastOpt = this.cmdOptionFor(args[i - 1])
            }

            if (arg === '--') {
                ret = ret.concat(args.slice(i))
                break
            } else if (lastOpt && lastOpt.required) {
                ret.push(arg)
            } else if (arg.length > 2 && arg[0] === '-' && arg[1] !== '-') {
                short = arg.slice(0, 2)
                opt = this.cmdOptionFor(short)
                if (opt && (opt.required || opt.optional)) {
                    ret.push(short)
                    ret.push(arg.slice(2))
                } else {
                    arg.slice(1)
                        .split('')
                        // eslint-disable-next-line no-loop-func
                        .forEach((c) => {
                            ret.push(`-${c}`)
                        })
                }
            } else if (/^--/.test(arg) && ~(index = arg.indexOf('='))) {
                ret.push(arg.slice(0, index), arg.slice(index + 1))
            } else {
                ret.push(arg)
            }
        }

        return ret
    }

    /** Return an option matching `arg` if any */
    private cmdOptionFor(arg): Option | null {
        for (let i = 0, len = this._cmdOptions.length; i < len; ++i) {
            if (this._cmdOptions[i].is(arg)) {
                return this._cmdOptions[i]
            }
        }
        return null
    }

    /** Return an object containing _cmdOptions as key-value pairs */
    public cmdOptionsObject(
        prevData: DataValues,
        data: DataValues
    ): DataValues {
        return this._cmdOptions.reduce(
            (accum, opt) => {
                const key = opt.attributeName()
                if (accum[key] == null) {
                    accum[key] = opt.defaultValue
                }
                return accum
            },
            { ...prevData, ...data }
        )
    }

    /** Argument `name` is missing */
    private missingArgument(name) {
        return `  error: required argument ${name} `
    }

    /** `Option` is missing an argument, but received `flag` or nothing */
    private optionMissingArgument(option: Option, flag?) {
        if (flag) {
            return `  error: option ${option.flags} argument missing, got ${flag}`
        }
        return `  error: option ${option.flags} argument missing`
    }

    /** Unknown option `flag` */
    private unknownOption(flag: string) {
        return `error: unknown option '${flag}'`
    }

    /** Variadic argument with `name` is not the last argument as required */
    private variadicArgNotLast(name: string) {
        return `error: variadic arguments must be last '${name}'`
    }

    public get meta(): any {
        const args = this._cmdArgs.map((arg) => {
            return humanReadableArgName(arg)
        })

        const usage = `[--Options]${this._commands.length ? ' [command]' : ''}${
            this._cmdArgs.length ? ` ${args.join(' ')}` : ''
        }`

        return {
            description: this._description,
            alias: this._alias,
            usage: this._usage || usage,
            name: this._name,
        }
    }

    /**
     * Set the description to `str`.
     */
    public description(
        str: string,
        argsDescription?: { [argName: string]: string }
    ): BotCommand {
        this._description = str
        this._argsDescription = argsDescription
        return this
    }

    /**
     * Set an alias for the command
     */
    public alias(alias: string): BotCommand {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let command: BotCommand = this

        if (this._commands.length !== 0) {
            command = this._commands[this._commands.length - 1]
        }

        if (arguments.length === 0) {
            return command._alias as any
        }

        if (alias === command._name) {
            throw new Error("BotCommand alias can't be the same as its name")
        }

        command._alias = alias

        return this
    }

    /**
     * Set / get the command usage `str`.
     */
    public usage(str: string): BotCommand {
        this._usage = str

        return this
    }

    /**
     * Get or set the name of the command
     */
    public name(str: string): BotCommand {
        this._name = str
        return this
    }

    /** Return prepared commands */
    private prepareCommands() {
        return this._commands
            .filter((cmd) => {
                return !cmd._noHelp
            })
            .map((cmd) => {
                const args = cmd._cmdArgs
                    .map((arg) => {
                        return humanReadableArgName(arg)
                    })
                    .join(' ')

                return [
                    cmd._name +
                        (cmd._alias ? `|${cmd._alias}` : '') +
                        (cmd._cmdOptions.length ? ' [_cmdOptions]' : '') +
                        (args ? ` ${args}` : ''),
                    cmd._description,
                ]
            })
    }

    /** Return the largest command length */
    private largestCommandLength() {
        const commands = this.prepareCommands()
        return commands.reduce((max, command) => {
            return Math.max(max, command[0].length)
        }, 0)
    }

    /** Return the largest option length */
    private largestOptionLength() {
        const _cmdOptions = [].slice.call(this._cmdOptions)
        _cmdOptions.push({
            flags: this._helpFlags,
        })

        return _cmdOptions.reduce((max, option) => {
            return Math.max(max, option.flags.length)
        }, 0)
    }

    /**  Return the largest arg length */
    private largestArgLength() {
        return this._cmdArgs.reduce((max, arg) => {
            return Math.max(max, arg.name.length)
        }, 0)
    }

    /** Return the pad width */
    private padWidth() {
        let width = this.largestOptionLength()
        if (this._argsDescription && this._cmdArgs.length) {
            if (this.largestArgLength() > width) {
                width = this.largestArgLength()
            }
        }

        if (this._commands && this._commands.length) {
            if (this.largestCommandLength() > width) {
                width = this.largestCommandLength()
            }
        }

        return width
    }

    /** Return help for _cmdOptions */
    private optionHelp() {
        const width = this.padWidth()

        // Append the help information
        return this._cmdOptions
            .map((option) => {
                return `${pad(option.flags, width)}  ${option.description}${
                    !option.negate && option.defaultValue !== undefined
                        ? ` (default: ${JSON.stringify(option.defaultValue)})`
                        : ''
                }`
            })
            .concat([
                `${pad(this._helpFlags, width)}  ${this._helpDescription}`,
            ])
            .join('\n')
    }

    /** Return command help documentation */
    private commandHelp() {
        if (!this._commands.length) {
            return ''
        }

        const commands = this.prepareCommands()
        const width = this.padWidth()

        return [
            'Commands:',
            commands
                .map((cmd) => {
                    const desc = cmd[1] ? `  ${cmd[1]}` : ''
                    return (desc ? pad(cmd[0], width) : cmd[0]) + desc
                })
                .join('\n\r')
                .replace(/^/gm, '  '),
            '',
        ].join('\n\r')
    }

    /** Return bot help documentation */
    private helpInformation() {
        let desc = []
        if (this._description) {
            desc = [this._description, '']

            const argsDescription = this._argsDescription
            if (argsDescription && this._cmdArgs.length) {
                const width = this.padWidth()
                desc.push('Arguments:')
                desc.push('')
                this._cmdArgs.forEach((arg) => {
                    desc.push(
                        `  ${pad(arg.name, width)}  ${
                            argsDescription[arg.name]
                        }`
                    )
                })
                desc.push('')
            }
        }

        let cmdName = this._name
        if (this._alias) {
            cmdName = `${cmdName}|${this._alias}`
        }
        let parentCmdNames = ''
        for (
            let parentCmd = this._parent;
            parentCmd;
            parentCmd = parentCmd._parent
        ) {
            parentCmdNames = `${parentCmd._name} ${parentCmdNames}`
        }
        const usage = [
            `Usage: ${parentCmdNames}${cmdName} ${this.meta.usage}`,
            '',
        ]

        let cmds = []
        const commandHelp = this.commandHelp()
        if (commandHelp) {
            cmds = [commandHelp]
        }

        const optionsText = [
            'Options:',
            `${this.optionHelp().replace(/^/gm, '  ')}`,
            '',
        ]

        return usage.concat(desc).concat(optionsText).concat(cmds).join('\n')
    }

    /**
     * Output help information for this command
     *
     * @api public
     */

    /** Sends a message using the configured send function */
    public async send(metadata: MetaData, msg: Message) {
        if (msg && msg.length > 0) {
            await this.parserConfig.send(metadata.context, msg)
        }
        metadata.resolve()
    }

    /**
    * Output help information for this command

    */
    public outputHelp(metadata: MetaData): Promise<void> {
        return this.send(metadata, this.helpInformation())
    }

    /**
     * You can pass in flags and a description to override the help
     * flags and help description for your command.
     */
    public helpOption(flags?: string, description?: string): BotCommand {
        this._helpFlags = flags || this._helpFlags
        this._helpDescription = description || this._helpDescription

        const splitFlags = this._helpFlags.split(/[ ,|]+/)

        if (splitFlags.length > 1) {
            this._helpShortFlag = splitFlags.shift()
        }

        this._helpLongFlag = splitFlags.shift()

        return this
    }

    /** Checks if showHelpOnError is true and in that case adds the help to the error string */
    private _checkShowHelp(arr: string[]) {
        if (this.parserConfig.showHelpOnError) {
            arr.push(this.helpInformation())
        }
    }

    /**
     * Output help information if necessary
     */
    private outputHelpIfNecessary(optionParams: string[]): string | null {
        optionParams = optionParams || []

        for (let i = 0; i < optionParams.length; i++) {
            if (
                optionParams[i] === this._helpLongFlag ||
                optionParams[i] === this._helpShortFlag
            ) {
                return this.helpInformation()
            }
        }

        return null
    }
}

/**
 * Camel-case the given `flag`
 */
function camelcase(flag) {
    return flag.split('-').reduce((str, word) => {
        return str + word[0].toUpperCase() + word.slice(1)
    })
}

/**
 * Pad `str` to `width`.
 */
function pad(str, width) {
    const len = Math.max(0, width - str.length)
    return str + Array(len + 1).join(' ')
}

/**
 * Takes an argument and returns its human readable equivalent for help usage.
 */
function humanReadableArgName(arg) {
    const nameOutput = arg.name + (arg.variadic === true ? '...' : '')

    return arg.required ? `<${nameOutput}>` : `[${nameOutput}]`
}
