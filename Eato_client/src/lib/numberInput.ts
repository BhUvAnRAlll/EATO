// Helpers for the number fields in profile setup (height, weight, body fat %)

// Keeps only digits (and one decimal point when allowed)
export const toNumberText = (text: string, decimals = false) =>
  decimals ? text.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 5) : text.replace(/\D/g, "").slice(0, 3);

// True when the field holds a number between min and max (an empty field is not in range)
export const inRange = (value: string, min: number, max: number) => {
  const n = Number(value);
  return value !== "" && n >= min && n <= max;
};
