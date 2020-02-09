
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

  trace(msg: string | Object)   { this.log(msg, LogLevel.TRACE); }
  debug(msg: string | Object)   { this.log(msg, LogLevel.DEBUG); }
  info(msg: string | Object)    { this.log(msg, LogLevel.INFO); }
  warning(msg: string | Object) { this.log(msg, LogLevel.WARNING); }
  error(msg: string | Error | Object)   { this.log(msg, LogLevel.ERROR); }

  log(msg: string | Object, level: LogLevel) {
    if (level >= this.level) {
      let className = 'Not within class';
      if (this.className) className = this.className;
      console.log('[' + className + ']: ' + msg);
    }
  }
}

export { Logger, LogLevel };