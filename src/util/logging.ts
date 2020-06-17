
enum LogLevel {
    TRACE = 0,
    DEBUG,
    INFO,
    WARNING,
    ERROR
};

class Logger {

  className? : string;
  level      : LogLevel;
  chained?   : Logger;

  constructor(className?: string, level=LogLevel.INFO) {
    this.className = className;
    this.level = level;
  }

  setLevel(level:LogLevel) {
    this.level = level;
  }

  trace(msg: string | Object | (() => string))            { this.log(msg, LogLevel.TRACE); }
  debug(msg: string | Object | (() => string))            { this.log(msg, LogLevel.DEBUG); }
  info(msg: string | Object | (() => string))             { this.log(msg, LogLevel.INFO); }
  warning(msg: string | Object  | (() => string))         { this.log(msg, LogLevel.WARNING); }
  error(msg: string | Error | Object  | (() => string))   { this.log(msg, LogLevel.ERROR); }

  log(msg: string | Object | (() => string), level: LogLevel) {
    if (level >= this.level) {
      let className = 'Not within class';
      if (this.className) className = this.className;
      const d = new Date();

      if (typeof(msg) === 'function') {
        msg = msg();
      }

      console.log('[' + className + ' ' + d.getHours() + ':' + d.getMinutes() + ' ' + d.getSeconds() + '.' + d.getMilliseconds().toString().padStart(3, '0') + ']: ' + msg);
    } else if (this.chained !== undefined) {
      // in case another logger in the chain has a more verbose log level.
      this.chained.log(msg, level);
    }

    
  }

  chain(logger: Logger) {
      this.chained = logger;
  }

  
}

export { Logger, LogLevel };