// What each function does and what its arguments are, for the Insert Function window and the
// Function Arguments help: a category (as Excel groups them, plus Chemistry), one line on what
// it gives, and each argument with a line of help. In an argument's name, [brackets] mark one
// that can be left out and … one that can be repeated.

import { FUNCTION_NAMES } from './evaluate';
import { PROPERTIES } from './properties';
import { ISOTOPE_FUNCTIONS } from './isotopes';

export const CATEGORIES = ['Chemistry', 'Math & Trig', 'Statistical', 'Logical', 'Text', 'Date & Time', 'Lookup & Reference', 'Arrays & LAMBDA', 'Information'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface FnArg {
  name: string;
  help: string;
  optional: boolean;
  /** Can be given again and again (number1, number2, …). */
  repeats: boolean;
}

export interface FnHelp {
  name: string;
  category: Category;
  /** One line on what it gives. */
  about: string;
  args: FnArg[];
}

type Entry = [Category, string, ...string[]];

const M: Category = 'Math & Trig', S: Category = 'Statistical', L: Category = 'Logical', T: Category = 'Text', D: Category = 'Date & Time',
  R: Category = 'Lookup & Reference', A: Category = 'Arrays & LAMBDA', I: Category = 'Information';

const DATE = 'date: a date (a cell holding one, DATE(2026,10,22), or text such as "2026-10-22")';
const START = 'start_date: the first date';
const END = 'end_date: the last date';
const HOLIDAYS = '[holidays]: dates that are not working days (a block of cells or {…})';
const WEEKEND = '[weekend]: which days are the weekend: 1 Saturday and Sunday (left out), 2 Sunday and Monday … 7 Friday and Saturday, 11 Sunday only … 17 Saturday only, or seven 0s and 1s from Monday ("0000011")';
const NUMS = 'number…: numbers, cells or blocks of cells';
const KNOWN_Y = "known_y's: the y values (the measured ones)";
const KNOWN_X = "known_x's: the x values, as many as the y values";
const LAMBDA_ARG = 'lambda: a LAMBDA giving the answer for each value, such as LAMBDA(x, x*2)';

const HELP: Record<string, Entry> = {
  // ---------------------------------------------------------------- maths
  SUM: [M, 'Adds up numbers.', NUMS],
  PRODUCT: [M, 'Multiplies numbers together.', NUMS],
  SUMPRODUCT: [M, 'Multiplies matching values of arrays the same size, and adds up the products.', 'array…: blocks of cells or arrays, all the same size'],
  SUMIF: [M, 'Adds up the cells that meet a condition.', 'range: the cells to test', 'criteria: the condition, such as ">50", "Pd*" or B2', '[sum_range]: the cells to add up, when not the tested ones'],
  SUMIFS: [M, 'Adds up the cells whose rows meet every condition.', 'sum_range: the cells to add up', 'criteria_range…: cells to test', 'criteria…: the condition for those cells'],
  ROUND: [M, 'Rounds a number to a number of decimal places (halves away from zero).', 'number: the number to round', '[num_digits]: decimal places (negative rounds to tens, hundreds…); 0 when left out'],
  ROUNDUP: [M, 'Rounds a number away from zero.', 'number: the number to round', '[num_digits]: decimal places'],
  ROUNDDOWN: [M, 'Rounds a number towards zero.', 'number: the number to round', '[num_digits]: decimal places'],
  INT: [M, 'Rounds a number down to a whole number.', 'number: the number'],
  ABS: [M, 'The number without its sign.', 'number: the number'],
  SQRT: [M, 'The square root.', 'number: a number of 0 or more'],
  EXP: [M, 'e raised to a power.', 'number: the power'],
  LN: [M, 'The natural logarithm.', 'number: a number above 0'],
  LOG10: [M, 'The logarithm to base 10.', 'number: a number above 0'],
  LOG: [M, 'The logarithm to a base.', 'number: a number above 0', '[base]: the base; 10 when left out'],
  POWER: [M, 'A number raised to a power.', 'number: the base', 'power: the power'],
  MOD: [M, 'The remainder after dividing (with the sign of the divisor).', 'number: the number to divide', 'divisor: what to divide by'],
  PI: [M, 'π to 15 figures.'],
  SUBTOTAL: [M, 'An average, count, sum… of a block (as a table\'s totals row uses it).', 'function_num: 1 average, 2 count, 3 count filled, 4 max, 5 min, 6 product, 7 stdev, 9 sum, 10 var (101… the same)', 'ref…: the cells'],
  // ---------------------------------------------------------------- statistics
  AVERAGE: [S, 'The mean of numbers.', NUMS],
  AVERAGEIF: [S, 'The mean of the cells that meet a condition.', 'range: the cells to test', 'criteria: the condition', '[average_range]: the cells to average'],
  AVERAGEIFS: [S, 'The mean of the cells whose rows meet every condition.', 'average_range: the cells to average', 'criteria_range…: cells to test', 'criteria…: the condition'],
  COUNT: [S, 'How many numbers there are.', 'value…: values, cells or blocks'],
  COUNTA: [S, 'How many cells are not empty.', 'value…: values, cells or blocks'],
  COUNTBLANK: [S, 'How many cells are empty.', 'range: the cells'],
  COUNTIF: [S, 'How many cells meet a condition.', 'range: the cells to test', 'criteria: the condition, such as ">50" or "Pd*"'],
  COUNTIFS: [S, 'How many rows meet every condition.', 'criteria_range…: cells to test', 'criteria…: the condition'],
  MAX: [S, 'The largest number.', NUMS],
  MIN: [S, 'The smallest number.', NUMS],
  MAXIFS: [S, 'The largest of the cells whose rows meet every condition.', 'max_range: the cells', 'criteria_range…: cells to test', 'criteria…: the condition'],
  MINIFS: [S, 'The smallest of the cells whose rows meet every condition.', 'min_range: the cells', 'criteria_range…: cells to test', 'criteria…: the condition'],
  MEDIAN: [S, 'The middle number.', NUMS],
  LARGE: [S, 'The k-th largest number.', 'array: the numbers', 'k: 1 for the largest, 2 the next…'],
  SMALL: [S, 'The k-th smallest number.', 'array: the numbers', 'k: 1 for the smallest, 2 the next…'],
  RANK: [S, 'A number\'s rank in a list (ties share the best rank).', 'number: the number', 'ref: the list', '[order]: 0 largest first (left out), 1 smallest first'],
  'RANK.EQ': [S, 'A number\'s rank in a list (ties share the best rank).', 'number: the number', 'ref: the list', '[order]: 0 largest first, 1 smallest first'],
  'RANK.AVG': [S, 'A number\'s rank in a list (ties share the average rank).', 'number: the number', 'ref: the list', '[order]: 0 largest first, 1 smallest first'],
  PERCENTILE: [S, 'The k-th percentile (k from 0 to 1).', 'array: the numbers', 'k: 0 to 1'],
  'PERCENTILE.INC': [S, 'The k-th percentile (k from 0 to 1, ends included).', 'array: the numbers', 'k: 0 to 1'],
  'PERCENTILE.EXC': [S, 'The k-th percentile (k between 0 and 1, ends left out).', 'array: the numbers', 'k: above 0 and below 1'],
  QUARTILE: [S, 'A quartile: 0 smallest, 1 lower quartile, 2 median, 3 upper quartile, 4 largest.', 'array: the numbers', 'quart: 0 to 4'],
  'QUARTILE.INC': [S, 'A quartile (ends included).', 'array: the numbers', 'quart: 0 to 4'],
  'QUARTILE.EXC': [S, 'A quartile (ends left out).', 'array: the numbers', 'quart: 1 to 3'],
  STDEV: [S, 'Standard deviation of a sample.', NUMS],
  'STDEV.S': [S, 'Standard deviation of a sample (n − 1).', NUMS],
  'STDEV.P': [S, 'Standard deviation of a whole population (n).', NUMS],
  STDEVP: [S, 'Standard deviation of a whole population (n).', NUMS],
  VAR: [S, 'Variance of a sample.', NUMS],
  'VAR.S': [S, 'Variance of a sample (n − 1).', NUMS],
  'VAR.P': [S, 'Variance of a whole population (n).', NUMS],
  VARP: [S, 'Variance of a whole population (n).', NUMS],
  SLOPE: [S, 'The slope of the least-squares straight line.', KNOWN_Y, KNOWN_X],
  INTERCEPT: [S, 'Where the least-squares straight line crosses x = 0.', KNOWN_Y, KNOWN_X],
  RSQ: [S, 'R² of the least-squares straight line.', KNOWN_Y, KNOWN_X],
  CORREL: [S, 'The correlation coefficient of two sets of values.', 'array1: the first values', 'array2: the second values'],
  STEYX: [S, 'The standard error of the y values predicted by the straight line.', KNOWN_Y, KNOWN_X],
  FORECAST: [S, 'The straight line\'s value at x.', 'x: where to read the line', KNOWN_Y, KNOWN_X],
  LINEST: [S, 'Least-squares fit of a straight line (or plane): slope(s) and intercept, spilled across; with stats, four more rows of errors and R².', KNOWN_Y, "[known_x's]: the x values (one column per variable); 1, 2, 3… when left out", '[const]: FALSE to force the line through 0', '[stats]: TRUE for the standard errors, R², F and sums of squares'],
  LOGEST: [S, 'Fit of an exponential curve y = b·mˣ: m and b, spilled across.', KNOWN_Y, "[known_x's]: the x values", '[const]: FALSE to make b 1', '[stats]: TRUE for the statistics'],
  'NORM.DIST': [S, 'The normal distribution.', 'x: the value', 'mean: the mean', 'standard_dev: the standard deviation', 'cumulative: TRUE for the area to the left, FALSE for the height'],
  NORMDIST: [S, 'The normal distribution.', 'x: the value', 'mean: the mean', 'standard_dev: the standard deviation', 'cumulative: TRUE or FALSE'],
  'NORM.INV': [S, 'The value with a given area to its left under a normal curve.', 'probability: 0 to 1', 'mean: the mean', 'standard_dev: the standard deviation'],
  NORMINV: [S, 'The value with a given area to its left under a normal curve.', 'probability: 0 to 1', 'mean: the mean', 'standard_dev: the standard deviation'],
  'NORM.S.DIST': [S, 'The standard normal distribution.', 'z: the value', 'cumulative: TRUE or FALSE'],
  NORMSDIST: [S, 'The area to the left of z under the standard normal curve.', 'z: the value'],
  'NORM.S.INV': [S, 'The z with a given area to its left under the standard normal curve.', 'probability: 0 to 1'],
  NORMSINV: [S, 'The z with a given area to its left under the standard normal curve.', 'probability: 0 to 1'],
  'T.DIST': [S, "Student's t distribution (left tail).", 'x: the value', 'deg_freedom: degrees of freedom', 'cumulative: TRUE or FALSE'],
  'T.DIST.2T': [S, "Student's t distribution, both tails.", 'x: a value of 0 or more', 'deg_freedom: degrees of freedom'],
  'T.DIST.RT': [S, "Student's t distribution, right tail.", 'x: the value', 'deg_freedom: degrees of freedom'],
  TDIST: [S, "Student's t distribution (one or two tails).", 'x: a value of 0 or more', 'deg_freedom: degrees of freedom', 'tails: 1 or 2'],
  'T.INV': [S, 'The t value with a given area to its left.', 'probability: 0 to 1', 'deg_freedom: degrees of freedom'],
  'T.INV.2T': [S, 'The two-tailed t value for a probability.', 'probability: 0 to 1', 'deg_freedom: degrees of freedom'],
  TINV: [S, 'The two-tailed t value for a probability.', 'probability: 0 to 1', 'deg_freedom: degrees of freedom'],
  'T.TEST': [S, "The probability from Student's t-test that two samples share a mean.", 'array1: the first sample', 'array2: the second sample', 'tails: 1 or 2', 'type: 1 paired, 2 equal variance, 3 unequal variance'],
  TTEST: [S, "The probability from Student's t-test.", 'array1: the first sample', 'array2: the second sample', 'tails: 1 or 2', 'type: 1, 2 or 3'],
  'CONFIDENCE.NORM': [S, 'Half the width of a confidence interval for a mean (normal distribution).', 'alpha: 0.05 for 95%', 'standard_dev: the standard deviation', 'size: the sample size'],
  'CONFIDENCE.T': [S, "Half the width of a confidence interval for a mean (Student's t).", 'alpha: 0.05 for 95%', 'standard_dev: the standard deviation', 'size: the sample size'],
  CONFIDENCE: [S, 'Half the width of a confidence interval for a mean.', 'alpha: 0.05 for 95%', 'standard_dev: the standard deviation', 'size: the sample size'],
  // ---------------------------------------------------------------- logic
  IF: [L, 'One value when a test is TRUE, another when FALSE.', 'logical_test: the test, such as B2>50', 'value_if_true: the answer when TRUE', '[value_if_false]: the answer when FALSE; FALSE when left out'],
  IFS: [L, 'The value of the first test that is TRUE.', 'logical_test…: a test', 'value_if_true…: its answer'],
  IFERROR: [L, 'A value, or something else when it is an error.', 'value: the value or calculation', 'value_if_error: the answer for an error'],
  IFNA: [L, 'A value, or something else when it is #N/A.', 'value: the value or calculation', 'value_if_na: the answer for #N/A'],
  SWITCH: [L, 'Compares a value with a list and gives the answer for the first match.', 'expression: the value', 'value…: a value to match', 'result…: its answer (one more at the end is the answer when nothing matches)'],
  AND: [L, 'TRUE when every test is TRUE.', 'logical…: tests'],
  OR: [L, 'TRUE when any test is TRUE.', 'logical…: tests'],
  NOT: [L, 'TRUE for FALSE, FALSE for TRUE.', 'logical: the test'],
  LET: [A, 'Names values, then works out a calculation with the names: LET(x, A1*2, x+1).', 'name1…: a name such as x or total', 'value1…: its value', 'calculation: the answer, using the names'],
  LAMBDA: [A, 'A function of your own: LAMBDA(x, x*2)(5) gives 10. Give it a name in the Name Manager to use it like any function.', 'parameter…: the names of its inputs', 'calculation: the answer, using them'],
  // ---------------------------------------------------------------- text
  CONCATENATE: [T, 'Joins texts together.', 'text…: texts, numbers or cells'],
  CONCAT: [T, 'Joins texts together, blocks of cells included.', 'text…: texts, cells or blocks'],
  TEXTJOIN: [T, 'Joins texts with something between them.', 'delimiter: what goes between, such as ", "', 'ignore_empty: TRUE to skip empty cells', 'text…: texts, cells or blocks'],
  TEXTSPLIT: [T, 'Splits text into columns (and rows), spilled.', 'text: the text', 'col_delimiter: what separates columns', '[row_delimiter]: what separates rows', '[ignore_empty]: TRUE to skip empty pieces', '[match_mode]: 1 to ignore case', '[pad_with]: what fills short rows; #N/A when left out'],
  LEN: [T, 'How many characters a text has.', 'text: the text'],
  LEFT: [T, 'The first characters of a text.', 'text: the text', '[num_chars]: how many; 1 when left out'],
  RIGHT: [T, 'The last characters of a text.', 'text: the text', '[num_chars]: how many; 1 when left out'],
  MID: [T, 'Characters from the middle of a text.', 'text: the text', 'start_num: the first character, 1 at the start', 'num_chars: how many'],
  FIND: [T, 'Where one text is found in another (capitals matter).', 'find_text: what to look for', 'within_text: where to look', '[start_num]: the character to start from'],
  SEARCH: [T, 'Where one text is found in another (capitals don\'t matter; * and ? as wildcards).', 'find_text: what to look for', 'within_text: where to look', '[start_num]: the character to start from'],
  SUBSTITUTE: [T, 'Puts new text in place of old text.', 'text: the text', 'old_text: what to replace', 'new_text: what goes in its place', '[instance_num]: which one to replace; all when left out'],
  REPLACE: [T, 'Replaces characters at a position.', 'old_text: the text', 'start_num: the first character to replace', 'num_chars: how many', 'new_text: what goes in their place'],
  UPPER: [T, 'Text in capitals.', 'text: the text'],
  LOWER: [T, 'Text in small letters.', 'text: the text'],
  TRIM: [T, 'Text without spaces at the ends, and single spaces between words.', 'text: the text'],
  TEXT: [T, 'A value written in a number format, as text.', 'value: the value', 'format_text: the format, such as "0.00" or "yyyy-mm-dd"'],
  VALUE: [T, 'Text read as a number.', 'text: the text'],
  HYPERLINK: [T, 'A link to follow with Ctrl+click.', 'link_location: a web page, DOI, file or #Sheet1!A1', '[friendly_name]: the text shown'],
  // ---------------------------------------------------------------- dates
  TODAY: [D, "Today's date (worked out again after every change)."],
  NOW: [D, 'The date and time now (worked out again after every change).'],
  DATE: [D, 'The date of a year, month and day. Months and days past the end carry on: DATE(2026,13,1) is 1 January 2027.', 'year: 1900 to 9999 (0 to 1899 count from 1900)', 'month: 1 to 12', 'day: 1 to 31'],
  TIME: [D, 'A time of day from hours, minutes and seconds.', 'hour: 0 to 23', 'minute: 0 to 59', 'second: 0 to 59'],
  YEAR: [D, 'The year of a date.', DATE],
  MONTH: [D, 'The month of a date, 1 to 12.', DATE],
  DAY: [D, 'The day of the month of a date, 1 to 31.', DATE],
  HOUR: [D, 'The hour of a time, 0 to 23.', 'serial_number: a time'],
  MINUTE: [D, 'The minute of a time, 0 to 59.', 'serial_number: a time'],
  SECOND: [D, 'The second of a time, 0 to 59.', 'serial_number: a time'],
  WEEKDAY: [D, 'The day of the week as a number.', DATE, '[return_type]: 1 Sunday = 1 (left out), 2 Monday = 1, 3 Monday = 0, 11–17 Monday…Sunday = 1'],
  WEEKNUM: [D, 'The week of the year.', DATE, '[return_type]: 1 weeks start on Sunday (left out), 2 Monday, 11–17 Monday…Sunday, 21 ISO weeks'],
  ISOWEEKNUM: [D, 'The ISO week of the year (weeks start on Monday).', DATE],
  DATEDIF: [D, 'Whole years, months or days between two dates.', START, END, 'unit: "Y" years, "M" months, "D" days, "MD" days leaving out months, "YM" months leaving out years, "YD" days leaving out years'],
  DAYS: [D, 'The days from one date to another.', END, START],
  EDATE: [D, 'The date some months before or after a date.', START, 'months: months on (negative for before)'],
  EOMONTH: [D, 'The last day of the month some months before or after a date.', START, 'months: months on (0 for this month)'],
  NETWORKDAYS: [D, 'The working days (Monday to Friday) from one date to another, both counted.', START, END, HOLIDAYS],
  'NETWORKDAYS.INTL': [D, 'The working days from one date to another, with your own weekend.', START, END, WEEKEND, HOLIDAYS],
  WORKDAY: [D, 'The working day some working days before or after a date.', START, 'days: working days on (negative for before)', HOLIDAYS],
  'WORKDAY.INTL': [D, 'The working day some working days on, with your own weekend.', START, 'days: working days on', WEEKEND, HOLIDAYS],
  DATEVALUE: [D, 'A date written as text, as a date.', 'date_text: such as "10/22/2026" or "22-Oct-2026"'],
  TIMEVALUE: [D, 'A time written as text, as a time.', 'time_text: such as "2:30 PM" or "14:30"'],
  // ---------------------------------------------------------------- lookup
  VLOOKUP: [R, 'Finds a value in the first column of a table and gives the value in another column of its row.', 'lookup_value: what to find', 'table_array: the table', 'col_index_num: the column to give, 1 for the first', '[range_lookup]: FALSE for an exact match; TRUE (left out) for the nearest in a sorted column'],
  HLOOKUP: [R, 'Finds a value in the first row of a table and gives the value in another row of its column.', 'lookup_value: what to find', 'table_array: the table', 'row_index_num: the row to give', '[range_lookup]: FALSE for an exact match'],
  XLOOKUP: [R, 'Finds a value in one row or column and gives what is in the same place of another.', 'lookup_value: what to find', 'lookup_array: where to look', 'return_array: what to give', '[if_not_found]: the answer when it isn\'t found', '[match_mode]: 0 exact, −1 or next smaller, 1 or next larger, 2 wildcards', '[search_mode]: 1 first to last, −1 last to first, 2 or −2 halving through sorted data'],
  MATCH: [R, 'Where a value is in a row or column.', 'lookup_value: what to find', 'lookup_array: where to look', '[match_type]: 0 exact, 1 (left out) largest at or below in ascending data, −1 smallest at or above in descending data'],
  XMATCH: [R, 'Where a value is in a row or column.', 'lookup_value: what to find', 'lookup_array: where to look', '[match_mode]: 0 exact, −1, 1 or 2 wildcards', '[search_mode]: 1, −1, 2 or −2'],
  INDEX: [R, 'The value at a row and column of a block (0 for the whole row or column).', 'array: the block', 'row_num: the row', '[column_num]: the column'],
  CHOOSE: [R, 'Picks a value from a list by its number.', 'index_num: 1 for the first value', 'value…: the values'],
  OFFSET: [R, 'A reference moved some rows and columns from another, and sized.', 'reference: where to start', 'rows: rows down (negative up)', 'cols: columns across (negative left)', '[height]: rows tall', '[width]: columns wide'],
  INDIRECT: [R, 'The reference written in a text.', 'ref_text: such as "B2" or "Sheet2!A1:C5"', '[a1]: FALSE for R1C1 style'],
  ROW: [R, 'The row number of a reference (or of the formula\'s own cell).', '[reference]: a cell or block'],
  COLUMN: [R, 'The column number of a reference (or of the formula\'s own cell).', '[reference]: a cell or block'],
  ROWS: [R, 'How many rows a block has.', 'array: the block'],
  COLUMNS: [R, 'How many columns a block has.', 'array: the block'],
  TRANSPOSE: [R, 'A block turned on its side: rows become columns (spilled).', 'array: the block'],
  // ---------------------------------------------------------------- arrays
  FILTER: [A, 'The rows (or columns) that pass a test, spilled.', 'array: the block to filter', 'include: TRUE/FALSE for each row, such as B2:B20>50 or (B2:B20>50)*(C2:C20="Pd")', '[if_empty]: the answer when nothing passes'],
  SORT: [A, 'A block sorted by one of its columns, spilled.', 'array: the block', '[sort_index]: the column to sort by; 1 when left out ({1,2} for two)', '[sort_order]: 1 smallest first (left out), −1 largest first', '[by_col]: TRUE to sort columns rather than rows'],
  SORTBY: [A, 'A block sorted by other columns of the same length, spilled.', 'array: the block', 'by_array…: what to sort by', '[sort_order…]: 1 smallest first, −1 largest first'],
  UNIQUE: [A, 'The rows of a block without repeats, spilled.', 'array: the block', '[by_col]: TRUE to compare columns', '[exactly_once]: TRUE for only the values that appear once'],
  SEQUENCE: [A, 'Numbers counting on, spilled.', 'rows: how many rows', '[columns]: how many columns; 1 when left out', '[start]: the first number; 1 when left out', '[step]: the step; 1 when left out'],
  VSTACK: [A, 'Blocks one above another, spilled.', 'array…: the blocks'],
  HSTACK: [A, 'Blocks side by side, spilled.', 'array…: the blocks'],
  TAKE: [A, 'The first (or, negative, last) rows and columns of a block.', 'array: the block', 'rows: how many rows', '[columns]: how many columns'],
  DROP: [A, 'A block without its first (or, negative, last) rows and columns.', 'array: the block', 'rows: how many rows to leave out', '[columns]: how many columns to leave out'],
  CHOOSEROWS: [A, 'Some rows of a block, spilled.', 'array: the block', 'row_num…: 1 for the first, −1 for the last'],
  CHOOSECOLS: [A, 'Some columns of a block, spilled.', 'array: the block', 'col_num…: 1 for the first, −1 for the last'],
  TOCOL: [A, 'A block as one column.', 'array: the block', '[ignore]: 1 to skip empty cells, 2 errors, 3 both', '[scan_by_column]: TRUE to go down the columns first'],
  TOROW: [A, 'A block as one row.', 'array: the block', '[ignore]: 1 to skip empty cells, 2 errors, 3 both', '[scan_by_column]: TRUE to go down the columns first'],
  MAP: [A, 'A LAMBDA worked out for each value of an array, spilled.', 'array…: one or more arrays the same size', LAMBDA_ARG],
  REDUCE: [A, 'One total carried through every value of an array by a LAMBDA.', 'initial_value: the starting total', 'array: the values', 'lambda: LAMBDA(total, value, …) giving the new total'],
  SCAN: [A, 'The running totals of a LAMBDA through an array, spilled.', 'initial_value: the starting total', 'array: the values', 'lambda: LAMBDA(total, value, …) giving the new total'],
  BYROW: [A, 'One answer for each row of a block, spilled down.', 'array: the block', 'lambda: LAMBDA(row, …) giving one value, such as LAMBDA(r, MAX(r))'],
  BYCOL: [A, 'One answer for each column of a block, spilled across.', 'array: the block', 'lambda: LAMBDA(column, …) giving one value'],
  MAKEARRAY: [A, 'An array made by a LAMBDA of its row and column numbers.', 'rows: how many rows', 'columns: how many columns', 'lambda: LAMBDA(r, c, …)'],
  // ---------------------------------------------------------------- information
  ISBLANK: [I, 'TRUE for an empty cell.', 'value: the cell'],
  ISNUMBER: [I, 'TRUE for a number.', 'value: the value'],
  ISTEXT: [I, 'TRUE for text.', 'value: the value'],
  ISERROR: [I, 'TRUE for any error.', 'value: the value'],
  ISNA: [I, 'TRUE for #N/A.', 'value: the value'],
  NA: [I, 'The error #N/A (nothing here), which charts skip.'],
};

const parseArg = (s: string): FnArg => {
  const colon = s.indexOf(':');
  let name = s.slice(0, colon).trim();
  const optional = name.startsWith('[');
  name = name.replace(/^\[|\]$/g, '');
  const repeats = name.endsWith('…');
  return { name: name.replace(/…$/, ''), help: s.slice(colon + 1).trim(), optional, repeats };
};

let all: Map<string, FnHelp> | null = null;

/** Every function with its help, chemistry first. */
export function functionHelp(): Map<string, FnHelp> {
  if (all) return all;
  all = new Map();
  for (const [name, p] of Object.entries(PROPERTIES)) {
    const args = [parseArg('structure: a cell holding a drawn structure or SMILES, or SMILES in quotes')];
    if (name === 'HRMS') args.push(parseArg('[ion]: the ion, such as "[M+Na]+"; [M+H]+ when left out'));
    if (name === 'DUPLICATE') args.push(parseArg('range: the cells to look in, such as B:B'));
    all.set(name, { name, category: 'Chemistry', about: `${p.label}: ${p.help}.`.replace(/\.\.$/, '.'), args });
  }
  for (const [name, p] of Object.entries(ISOTOPE_FUNCTIONS)) {
    all.set(name, {
      name, category: 'Chemistry', about: `${p.label}: ${p.help}.`,
      args: ['structure: a structure, SMILES or formula (C10H12N2O)', '[ion]: the ion, such as "[M+H]+"', '[peak]: 0 for M, 1 for M+1, 2 for M+2…'].map(parseArg),
    });
  }
  for (const name of FUNCTION_NAMES) {
    if (all.has(name)) continue;
    const e = HELP[name];
    all.set(name, e ? { name, category: e[0], about: e[1], args: e.slice(2).map(parseArg) } : { name, category: 'Math & Trig', about: '', args: [] });
  }
  return all;
}

/** A function's syntax as Excel writes it: ROUND(number, [num_digits]). */
export function syntaxOf(h: FnHelp): string {
  return `${h.name}(${h.args.map((a) => {
    const n = a.repeats ? `${a.name}1, [${a.name}2], …` : a.name;
    return a.optional ? `[${n}]` : n;
  }).join(', ')})`;
}

/** Functions matching what was typed in the search box: names first, then descriptions. */
export function searchFunctions(text: string, category?: Category): FnHelp[] {
  const list = [...functionHelp().values()].filter((h) => !category || h.category === category);
  const q = text.trim().toLowerCase();
  if (!q) return list.sort((a, b) => (category ? a.name.localeCompare(b.name) : 0));
  const words = q.split(/\s+/);
  const score = (h: FnHelp): number => {
    const n = h.name.toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    const about = `${h.about} ${h.args.map((a) => a.help).join(' ')}`.toLowerCase();
    if (words.every((w) => about.includes(w))) return 3;
    return -1;
  };
  return list.map((h) => ({ h, s: score(h) })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || a.h.name.localeCompare(b.h.name)).map((x) => x.h);
}
