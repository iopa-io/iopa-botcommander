import { util } from 'iopa';
export const { EventEmitter } = util;
export class Option {
    constructor(flags, description) {
        this.flags = flags;
        this.required = flags.indexOf('<') >= 0;
        this.optional = flags.indexOf('[') >= 0;
        this.negate = flags.indexOf('-no-') !== -1;
        const flagsArray = flags.split(/[ ,|]+/);
        if (flagsArray.length > 1 && !/^[[<]/.test(flagsArray[1])) {
            this.short = flagsArray.shift();
        }
        this.long = flagsArray.shift();
        this.description = description || '';
        this.parseValue = (arg) => arg;
    }
    name() {
        return this.long.replace(/^--/, '');
    }
    attributeName() {
        return camelcase(this.name().replace(/^no-/, ''));
    }
    is(arg) {
        return this.short === arg || this.long === arg;
    }
}
export class BotCommand extends EventEmitter {
    constructor(name) {
        super();
        this._alias = null;
        this._noHelp = false;
        this._prefixes = null;
        this._cmdArgs = [];
        this._cmdOptions = [];
        this._commands = [];
        this._helpFlags = '-h, --help';
        this._helpDescription = 'output usage information';
        this._helpShortFlag = '-h';
        this._helpLongFlag = '--help';
        this.parserConfig = {
            send: null,
            allowUnknownOption: false,
            showHelpOnError: true,
            lowerCase: false,
            showHelpOnEmpty: false,
        };
        this._name = name || '';
    }
    command(nameAndArgs, config = {}) {
        const args = nameAndArgs.split(/ +/);
        const cmd = new BotCommand(args.shift());
        cmd.setParserConfig(this.parserConfig);
        cmd._noHelp = !!config.noHelp;
        cmd._helpFlags = this._helpFlags;
        cmd._helpDescription = this._helpDescription;
        cmd._helpShortFlag = this._helpShortFlag;
        cmd._helpLongFlag = this._helpLongFlag;
        this._commands.push(cmd);
        cmd.parseExpectedArgs(args);
        cmd._parent = this;
        if (this._commands.length === 1 && args[0] !== 'help') {
            this.addImplicitHelpCommand();
        }
        return cmd;
    }
    setParserConfig(parserConfig) {
        this.parserConfig = parserConfig;
    }
    arguments(desc) {
        return this.parseExpectedArgs(desc.split(/ +/));
    }
    addImplicitHelpCommand() {
        this.command('help [cmd]').description('display help for [cmd]');
    }
    parseExpectedArgs(args) {
        if (!args.length) {
            return this;
        }
        args.forEach((arg) => {
            const argDetails = {
                required: false,
                name: '',
                variadic: false,
            };
            switch (arg[0]) {
                case '<':
                    argDetails.required = true;
                    argDetails.name = arg.slice(1, -1);
                    break;
                case '[':
                    argDetails.name = arg.slice(1, -1);
                    break;
                default:
            }
            if (argDetails.name.length > 3 &&
                argDetails.name.slice(-3) === '...') {
                argDetails.variadic = true;
                argDetails.name = argDetails.name.slice(0, -3);
            }
            if (argDetails.name) {
                this._cmdArgs.push(argDetails);
            }
        });
        return this;
    }
    action(fn) {
        const listener = async (prevParsed, metadata) => {
            let args = prevParsed.args || [];
            const parsed = this.parseLine((prevParsed.unknown || []).join(' '));
            if (parsed.errors.length > 0) {
                this._checkShowHelp(parsed.errors);
                await this.send(metadata, parsed.errors.join('\n'));
                return;
            }
            const helptext = this.outputHelpIfNecessary(parsed.unknown);
            if (helptext) {
                await this.send(metadata, helptext);
                return;
            }
            if (parsed.unknown.length > 0 &&
                !this.parserConfig.allowUnknownOption) {
                const msg = [];
                msg.push(this.unknownOption(parsed.unknown[0]));
                this._checkShowHelp(msg);
                await this.send(metadata, msg.join('\n'));
                return;
            }
            args = prevParsed.args.concat(parsed.args);
            const data = this.cmdOptionsObject(prevParsed.data, parsed.data);
            const errors = [];
            this._cmdArgs.forEach((arg, i) => {
                if (args[i] && args[i].match(/["'].+["']/)) {
                    data[arg.name] = args[i].substring(1, args[i].length - 1);
                }
                else if (args[i] && args[i].startsWith('@')) {
                    data[arg.name] = args[i].substring(1);
                }
                else {
                    data[arg.name] = args[i] || null;
                }
                if (arg.required && args[i] == null) {
                    errors.push(this.missingArgument(arg.name));
                }
                else if (arg.variadic) {
                    if (i !== this._cmdArgs.length - 1) {
                        errors.push(this.variadicArgNotLast(arg.name));
                    }
                    data[arg.name] = args.splice(i);
                }
            });
            if (errors.length > 0) {
                this._checkShowHelp(errors);
                await this.send(metadata, errors.join('\n'));
                return;
            }
            try {
                await fn.call(this, metadata.context, data);
            }
            catch (ex) {
                console.error(ex);
                await this.send(metadata, `${ex.statusText || ex.message || ex.toString()}`);
            }
            metadata.resolve();
        };
        const parent = this._parent || this;
        const name = parent === this ? '*' : this._name;
        this.on(`command:${name}`, listener);
        if (this._alias) {
            this.on(`command:${this._alias}`, listener);
        }
        return this;
    }
    api(fn) {
        const parent = this._parent || this;
        const name = parent === this ? '*' : this._name;
        this._noHelp = true;
        const listener = async (metadata, data) => {
            await fn.call(this, metadata.context, data);
            metadata.resolve();
        };
        this._parent.on(`api:${name}`, listener);
        if (this._alias) {
            parent.on(`api:${this._alias}`, listener);
        }
        return this;
    }
    async invoke(name, context, data) {
        let metadata;
        await new Promise((resolve, reject) => {
            metadata = { context, resolve, reject };
            const command = this._commands.find((cmd) => cmd._name === name || cmd._alias === name);
            if (command) {
                this.emit(`api:${name}`, metadata, data);
            }
            else {
                resolve();
            }
        });
        context.log('botcommander action  complete');
        metadata = null;
    }
    option(flags, description, fn, defaultValue) {
        const option = new Option(flags, description);
        const oname = option.name();
        const name = option.attributeName();
        if (typeof fn !== 'function') {
            if (fn instanceof RegExp) {
                const regex = fn;
                fn = (val, def) => {
                    const m = regex.exec(val);
                    return m ? m[0] : def;
                };
            }
            else {
                defaultValue = fn;
                fn = null;
            }
        }
        if (option.negate ||
            option.optional ||
            option.required ||
            typeof defaultValue === 'boolean') {
            if (option.negate) {
                const opts = this.cmdOptionsObject({}, {});
                defaultValue = Object.prototype.hasOwnProperty.call(opts, name)
                    ? opts[name]
                    : true;
            }
            if (defaultValue !== undefined) {
                this[name] = defaultValue;
                option.defaultValue = defaultValue;
            }
        }
        this._cmdOptions.push(option);
        this.on(`option:${oname}`, (val) => {
            if (val !== null && fn) {
                val = fn(val, this[name] === undefined ? defaultValue : this[name]);
            }
            if (typeof this[name] === 'boolean' ||
                typeof this[name] === 'undefined') {
                if (val == null) {
                    this[name] = option.negate ? false : defaultValue || true;
                }
                else {
                    this[name] = val;
                }
            }
            else if (val !== null) {
                this[name] = option.negate ? false : val;
            }
        });
        return this;
    }
    configAllowUnknownOption(arg = true) {
        this.parserConfig.allowUnknownOption = arg;
        return this;
    }
    configSetSend(cb) {
        this.parserConfig.send = cb;
        return this;
    }
    configShowHelpOnError(arg = true) {
        this.parserConfig.showHelpOnError = arg;
        return this;
    }
    configShowHelpOnEmpty(arg = true) {
        this.parserConfig.showHelpOnEmpty = arg;
        return this;
    }
    configPrefix(prefix) {
        if (typeof prefix === 'string') {
            this._prefixes = [prefix];
        }
        else {
            this._prefixes = prefix;
        }
        return this;
    }
    async parse(line, context) {
        return new Promise(async (resolve, reject) => {
            const metadata = { context, resolve, reject };
            if (this._prefixes) {
                const prefixFound = this._prefixes.find((prefix) => line.startsWith(prefix));
                if (prefixFound == null) {
                    resolve();
                    return;
                }
                line = line.substring(prefixFound.length);
            }
            const parsed = this.parseLine(line);
            if (parsed.errors.length > 0) {
                this._checkShowHelp(parsed.errors);
                this.send(metadata, parsed.errors.join('\n'));
                return;
            }
            delete parsed.errors;
            this.parseCommand(parsed, metadata);
        });
    }
    parseLine(line, prevResult) {
        const rawArgs = line
            .split(/(".+?")|('.+?')|\s+/g)
            .filter((a) => a && a.length > 0);
        const argv = this.normalize(rawArgs);
        const args = [];
        const errors = [];
        const data = prevResult ? prevResult.data : {};
        const len = argv.length;
        let literal;
        let option;
        let arg;
        const unknownOptions = [];
        for (let i = 0; i < len; ++i) {
            arg = argv[i];
            if (literal) {
                args.push(arg);
                continue;
            }
            if (arg === '--') {
                literal = true;
                continue;
            }
            option = this.cmdOptionFor(arg);
            if (option) {
                const name = option.name();
                if (option.required) {
                    arg = argv[++i];
                    if (arg == null) {
                        errors.push(this.optionMissingArgument(option));
                    }
                    else {
                        this.emit(`option:${name}`, arg);
                    }
                    data[name] = option.parseValue(arg, data[name]);
                }
                else if (option.optional) {
                    arg = argv[i + 1];
                    if (arg == null || (arg[0] === '-' && arg !== '-')) {
                        arg = null;
                    }
                    else {
                        ++i;
                    }
                    data[name] = option.parseValue(arg, data[name]);
                    this.emit(`option:${option.name()}`, arg);
                }
                else {
                    data[name] = option.parseValue(null, data[name]);
                    this.emit(`option:${option.name()}`);
                }
                continue;
            }
            if (arg.length > 1 && arg[0] === '-') {
                unknownOptions.push(arg);
                if (i + 1 < argv.length &&
                    (argv[i + 1][0] !== '-' || argv[i + 1] === '-')) {
                    unknownOptions.push(argv[++i]);
                }
                continue;
            }
            args.push(arg);
        }
        return {
            line: prevResult ? prevResult.line : line,
            args,
            data,
            rawArgs: prevResult ? prevResult.rawArgs : rawArgs,
            unknown: unknownOptions,
            errors,
        };
    }
    async parseCommand(parsed, metadata) {
        const { args } = parsed;
        let name;
        if (args.length && args[0] !== '') {
            name = args[0];
            if (this.parserConfig.lowerCase) {
                name = name.toLowerCase();
            }
            if (name === 'help' && args.length === 1) {
                this.outputHelp(metadata);
                return;
            }
            if (name === 'help') {
                args.shift();
                name = args[0];
                parsed.unknown.push('--help');
                parsed.rawArgs = parsed.rawArgs.slice(1);
                parsed.rawArgs.push('--help');
            }
            if (this.listeners.has(`command:${name}`)) {
                args.shift();
                this.emit(`command:${name}`, parsed, metadata);
            }
            else {
                const command = this._commands.find((cmd) => cmd._name === name || cmd._alias === name);
                if (command) {
                    const line = parsed.rawArgs.slice(1).join(' ');
                    const newResult = command.parseLine(line, parsed);
                    command.emit(`command:${name}`, newResult, metadata);
                }
                else {
                    this.emit('command:*', parsed, metadata);
                }
            }
        }
        else if (this.parserConfig.showHelpOnEmpty) {
            const helptext = this.outputHelpIfNecessary(parsed.unknown);
            if (helptext) {
                await this.send(metadata, helptext);
            }
        }
    }
    normalize(args) {
        let ret = [];
        let arg;
        let lastOpt;
        let index;
        let short;
        let opt;
        for (let i = 0, len = args.length; i < len; ++i) {
            arg = args[i];
            if (i > 0) {
                lastOpt = this.cmdOptionFor(args[i - 1]);
            }
            if (arg === '--') {
                ret = ret.concat(args.slice(i));
                break;
            }
            else if (lastOpt && lastOpt.required) {
                ret.push(arg);
            }
            else if (arg.length > 2 && arg[0] === '-' && arg[1] !== '-') {
                short = arg.slice(0, 2);
                opt = this.cmdOptionFor(short);
                if (opt && (opt.required || opt.optional)) {
                    ret.push(short);
                    ret.push(arg.slice(2));
                }
                else {
                    arg.slice(1)
                        .split('')
                        .forEach((c) => {
                        ret.push(`-${c}`);
                    });
                }
            }
            else if (/^--/.test(arg) && ~(index = arg.indexOf('='))) {
                ret.push(arg.slice(0, index), arg.slice(index + 1));
            }
            else {
                ret.push(arg);
            }
        }
        return ret;
    }
    cmdOptionFor(arg) {
        for (let i = 0, len = this._cmdOptions.length; i < len; ++i) {
            if (this._cmdOptions[i].is(arg)) {
                return this._cmdOptions[i];
            }
        }
        return null;
    }
    cmdOptionsObject(prevData, data) {
        return this._cmdOptions.reduce((accum, opt) => {
            const key = opt.attributeName();
            if (accum[key] == null) {
                accum[key] = opt.defaultValue;
            }
            return accum;
        }, { ...prevData, ...data });
    }
    missingArgument(name) {
        return `  error: required argument ${name} `;
    }
    optionMissingArgument(option, flag) {
        if (flag) {
            return `  error: option ${option.flags} argument missing, got ${flag}`;
        }
        return `  error: option ${option.flags} argument missing`;
    }
    unknownOption(flag) {
        return `error: unknown option '${flag}'`;
    }
    variadicArgNotLast(name) {
        return `error: variadic arguments must be last '${name}'`;
    }
    get meta() {
        const args = this._cmdArgs.map((arg) => {
            return humanReadableArgName(arg);
        });
        const usage = `[--Options]${this._commands.length ? ' [command]' : ''}${this._cmdArgs.length ? ` ${args.join(' ')}` : ''}`;
        return {
            description: this._description,
            alias: this._alias,
            usage: this._usage || usage,
            name: this._name,
        };
    }
    description(str, argsDescription) {
        this._description = str;
        this._argsDescription = argsDescription;
        return this;
    }
    alias(alias) {
        let command = this;
        if (this._commands.length !== 0) {
            command = this._commands[this._commands.length - 1];
        }
        if (arguments.length === 0) {
            return command._alias;
        }
        if (alias === command._name) {
            throw new Error("BotCommand alias can't be the same as its name");
        }
        command._alias = alias;
        return this;
    }
    usage(str) {
        this._usage = str;
        return this;
    }
    name(str) {
        this._name = str;
        return this;
    }
    prepareCommands() {
        return this._commands
            .filter((cmd) => {
            return !cmd._noHelp;
        })
            .map((cmd) => {
            const args = cmd._cmdArgs
                .map((arg) => {
                return humanReadableArgName(arg);
            })
                .join(' ');
            return [
                cmd._name +
                    (cmd._alias ? `|${cmd._alias}` : '') +
                    (cmd._cmdOptions.length ? ' [_cmdOptions]' : '') +
                    (args ? ` ${args}` : ''),
                cmd._description,
            ];
        });
    }
    largestCommandLength() {
        const commands = this.prepareCommands();
        return commands.reduce((max, command) => {
            return Math.max(max, command[0].length);
        }, 0);
    }
    largestOptionLength() {
        const _cmdOptions = [].slice.call(this._cmdOptions);
        _cmdOptions.push({
            flags: this._helpFlags,
        });
        return _cmdOptions.reduce((max, option) => {
            return Math.max(max, option.flags.length);
        }, 0);
    }
    largestArgLength() {
        return this._cmdArgs.reduce((max, arg) => {
            return Math.max(max, arg.name.length);
        }, 0);
    }
    padWidth() {
        let width = this.largestOptionLength();
        if (this._argsDescription && this._cmdArgs.length) {
            if (this.largestArgLength() > width) {
                width = this.largestArgLength();
            }
        }
        if (this._commands && this._commands.length) {
            if (this.largestCommandLength() > width) {
                width = this.largestCommandLength();
            }
        }
        return width;
    }
    optionHelp() {
        const width = this.padWidth();
        return this._cmdOptions
            .map((option) => {
            return `${pad(option.flags, width)}  ${option.description}${!option.negate && option.defaultValue !== undefined
                ? ` (default: ${JSON.stringify(option.defaultValue)})`
                : ''}`;
        })
            .concat([
            `${pad(this._helpFlags, width)}  ${this._helpDescription}`,
        ])
            .join('\n');
    }
    commandHelp() {
        if (!this._commands.length) {
            return '';
        }
        const commands = this.prepareCommands();
        const width = this.padWidth();
        return [
            'Commands:',
            commands
                .map((cmd) => {
                const desc = cmd[1] ? `  ${cmd[1]}` : '';
                return (desc ? pad(cmd[0], width) : cmd[0]) + desc;
            })
                .join('\n\r')
                .replace(/^/gm, '  '),
            '',
        ].join('\n\r');
    }
    helpInformation() {
        let desc = [];
        if (this._description) {
            desc = [this._description, ''];
            const argsDescription = this._argsDescription;
            if (argsDescription && this._cmdArgs.length) {
                const width = this.padWidth();
                desc.push('Arguments:');
                desc.push('');
                this._cmdArgs.forEach((arg) => {
                    desc.push(`  ${pad(arg.name, width)}  ${argsDescription[arg.name]}`);
                });
                desc.push('');
            }
        }
        let cmdName = this._name;
        if (this._alias) {
            cmdName = `${cmdName}|${this._alias}`;
        }
        let parentCmdNames = '';
        for (let parentCmd = this._parent; parentCmd; parentCmd = parentCmd._parent) {
            parentCmdNames = `${parentCmd._name} ${parentCmdNames}`;
        }
        const usage = [
            `Usage: ${parentCmdNames}${cmdName} ${this.meta.usage}`,
            '',
        ];
        let cmds = [];
        const commandHelp = this.commandHelp();
        if (commandHelp) {
            cmds = [commandHelp];
        }
        const optionsText = [
            'Options:',
            `${this.optionHelp().replace(/^/gm, '  ')}`,
            '',
        ];
        return usage.concat(desc).concat(optionsText).concat(cmds).join('\n');
    }
    async send(metadata, msg) {
        if (msg && msg.length > 0) {
            await this.parserConfig.send(metadata.context, msg);
        }
        metadata.resolve();
    }
    outputHelp(metadata) {
        return this.send(metadata, this.helpInformation());
    }
    helpOption(flags, description) {
        this._helpFlags = flags || this._helpFlags;
        this._helpDescription = description || this._helpDescription;
        const splitFlags = this._helpFlags.split(/[ ,|]+/);
        if (splitFlags.length > 1) {
            this._helpShortFlag = splitFlags.shift();
        }
        this._helpLongFlag = splitFlags.shift();
        return this;
    }
    _checkShowHelp(arr) {
        if (this.parserConfig.showHelpOnError) {
            arr.push(this.helpInformation());
        }
    }
    outputHelpIfNecessary(optionParams) {
        optionParams = optionParams || [];
        for (let i = 0; i < optionParams.length; i++) {
            if (optionParams[i] === this._helpLongFlag ||
                optionParams[i] === this._helpShortFlag) {
                return this.helpInformation();
            }
        }
        return null;
    }
}
function camelcase(flag) {
    return flag.split('-').reduce((str, word) => {
        return str + word[0].toUpperCase() + word.slice(1);
    });
}
function pad(str, width) {
    const len = Math.max(0, width - str.length);
    return str + Array(len + 1).join(' ');
}
function humanReadableArgName(arg) {
    const nameOutput = arg.name + (arg.variadic === true ? '...' : '');
    return arg.required ? `<${nameOutput}>` : `[${nameOutput}]`;
}
//# sourceMappingURL=parser.js.map