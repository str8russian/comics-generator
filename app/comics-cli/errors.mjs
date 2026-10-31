export class CliError extends Error {
  constructor(message, { usage = false, stdout = "", exitCode = 1 } = {}) {
    super(message);
    this.name = "CliError";
    this.usage = usage;
    this.stdout = stdout;
    this.exitCode = exitCode;
  }
}
