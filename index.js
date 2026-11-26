const http = require("http");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;

console.log("TOKEN length:", TOKEN ? TOKEN.length : "MISSING");
console.log("CLIENT_ID:", CLIENT_ID ? "set" : "MISSING");
console.log("GUILD_ID:", GUILD_ID ? "set" : "MISSING");

// Tiny web server so Fly's proxy gets an answer
const PORT = process.env.PORT || 8080;
http
  .createServer((req, res) => res.end("ok"))
  .listen(PORT, "0.0.0.0", () => console.log(`Web server listening on ${PORT}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot is alive"),

  new SlashCommandBuilder()
    .setName("about")
    .setDescription("Learn about Project Select"),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Make the bot say something")
    .addStringOption((o) =>
      o.setName("text").setDescription("What to say").setRequired(true)
    ),
];

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log("Slash commands registered");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "ping") {
      return interaction.reply(`Pong! ${client.ws.ping}ms`);
    }

    if (interaction.commandName === "about") {
      const embed = new EmbedBuilder()
        .setTitle("Project Select")
        .setDescription(
          "A universal script hub for Arsenal, Phantom Forces, MM2, Rivals and Universal, with an AI config assistant. Join the Discord to be selected as a beta tester."
        )
        .setColor(0xff3b4e);
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "say") {
      const text = interaction.options.getString("text");
      return interaction.reply({
        content: text,
        allowedMentions: { parse: [] },
      });
    }
  } catch (err) {
    console.error("Command error:", err);
  }
});

client.on("error", (err) => console.error("Client error:", err));
process.on("unhandledRejection", (err) =>
  console.error("Unhandled rejection:", err)
);

client.login(TOKEN).catch((err) => console.error("Login failed:", err));
