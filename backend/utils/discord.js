// Sends a formatted message to a Discord channel via webhook, if one is configured.
// Getting a webhook URL: in Discord, go to a channel's Settings -> Integrations -> Webhooks -> New Webhook -> Copy URL.

const categoryColors = {
  Emergency: 15158332, // red
  "System Update": 15844367, // amber
  "General Announcement": 2802940, // teal
};

async function sendDiscordAlert(alert) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return false; // silently skip if not configured - this is optional

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: alert.title,
            description: alert.message,
            color: categoryColors[alert.category] || 3447003,
            fields: [
              { name: "Category", value: alert.category, inline: true },
              { name: "Groups", value: alert.targetGroups.join(", "), inline: true },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("Discord webhook failed:", err.message);
    return false;
  }
}

module.exports = sendDiscordAlert;
