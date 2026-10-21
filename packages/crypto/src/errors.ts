export class Oce1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Oce1Error";
  }
}

export class ValidationError extends Oce1Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class UnsupportedFormatError extends Oce1Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

export class BindingError extends Oce1Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingError";
  }
}

export class AuthenticationError extends Oce1Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class ManifestError extends Oce1Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

export class TrailingDataError extends Oce1Error {
  constructor(message: string) {
    super(message);
    this.name = "TrailingDataError";
  }
}
