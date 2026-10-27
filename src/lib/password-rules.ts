// Shared by the server check and the forms, so the hint and `minlength` can't drift from the rule.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters, with a number and a special character.`;
