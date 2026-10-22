/**
 * Every refusal of the installer has a name, printed first, so that a person
 * or an agent reading it knows what to fix without parsing a sentence.
 */
export class NexgenError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'NexgenError';
  }
}
