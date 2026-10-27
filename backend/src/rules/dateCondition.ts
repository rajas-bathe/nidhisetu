/**
 * Derived date condition for an instrument.
 *
 * IMPORTANT: this conditions on recorded calendar dates only. A matured
 * receipt is NOT, by itself, a legal violation - it is a data-upkeep signal
 * that drives renewal tasks under the configured sample policy.
 */

export type DateCondition = "current" | "approaching_maturity" | "matured";

export function deriveDateCondition(
  today: string,
  maturityDate: string,
  approachingWindowDays: number,
): DateCondition {
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number) as [number, number, number];
  const [cpYear, cpMonth, cpDay] = maturityDate.split("-").map(Number) as [number, number, number];
  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const cpUtc = Date.UTC(cpYear, cpMonth - 1, cpDay);
  const dayDiff = Math.round((cpUtc - todayUtc) / 86_400_000);

  if (dayDiff < 0) {
    return "matured";
  }
  if (dayDiff <= approachingWindowDays) {
    return "approaching_maturity";
  }
  return "current";
}
