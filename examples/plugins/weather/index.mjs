/**
 * Weather plugin for Muninn
 *
 * Uses wttr.in — no API key needed.
 * Drop this folder into ~/.muninn/plugins/ to enable.
 */
export default async function execute(args) {
  const city = args.city || 'Oslo';

  try {
    const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    if (!response.ok) {
      return `Could not get weather for ${city}.`;
    }

    const data = await response.json();
    const current = data.current_condition?.[0];

    if (!current) {
      return `No weather data available for ${city}.`;
    }

    const temp = current.temp_C;
    const feels = current.FeelsLikeC;
    const desc = current.weatherDesc?.[0]?.value || 'Unknown';
    const humidity = current.humidity;
    const wind = current.windspeedKmph;

    return `🌤 Weather in ${city}:\n` +
      `${desc}, ${temp}°C (feels like ${feels}°C)\n` +
      `Humidity: ${humidity}% | Wind: ${wind} km/h`;
  } catch (error) {
    return `Weather lookup failed: ${error.message}`;
  }
}
