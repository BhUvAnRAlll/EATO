// The optional contact email on setup step 1 (pure, unit-tested). The server checks it again
// with the same rule (JustFit_server/profile.js); it is never verified or used to sign in.
export const EMAIL_MAX = 120;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,100}\.[A-Za-z]{2,}$/;

export const isValidEmail = (value: string) => value.length <= EMAIL_MAX && EMAIL.test(value.trim());
