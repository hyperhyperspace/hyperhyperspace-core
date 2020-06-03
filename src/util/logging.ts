
enum LogLevel {
    TRACE = 0,
    DEBUG,
    INFO,
    WARNING,
    ERROR
};

class Logger {

    className? : string;
    level     : LogLevel; 

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
    }
  }
}

export { Logger, LogLevel };