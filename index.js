const http = require("http");
const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;

// Tiny web server so Fly's proxy gets an answer
const PORT = process.env.PORT || 8080;
http
  .createServer((req, res) => res.end("ok"))
  .listen(PORT, "0.0.0.0", () => console.log(`Web server listening on ${PORT}`));

// ---------- Saved settings ----------
const CHANNEL_FILE = "./channel.json";
const BETA_FILE = "./beta.json";

let announceChannelId = process.env.ANNOUNCE_CHANNEL_ID || null;
try {
  announceChannelId =
    JSON.parse(fs.readFileSync(CHANNEL_FILE, "utf8")).id || announceChannelId;
} catch {}

let reviewerId = process.env.OWNER_ID || null;
try {
  reviewerId =
    JSON.parse(fs.readFileSync(BETA_FILE, "utf8")).reviewerId || reviewerId;
} catch {}

// ---------- Executor status (WEAO) ----------
const WEAO_URL = "https://weao.xyz/api/status/exploits";
let cache = { at: 0, data: null };
let loggedSample = false;

async function getExploits(force = false) {
  if (!force && cache.data && Date.now() - cache.at < 60000) return cache.data;
  const res = await fetch(WEAO_URL, {
    headers: { "User-Agent": "WEAO-3PService" },
  });
  if (!res.ok) throw new Error(`WEAO returned ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : Object.values(data);
  if (!loggedSample) {
    console.log("WEAO sample item:", JSON.stringify(list[0]));
    loggedSample = true;
  }
  cache = { at: Date.now(), data: list };
  return list;
}

function category(e) {
  const platform = String(e.platform || "").toLowerCase();
  const type = String(e.extype || e.type || "").toLowerCase();
  if (/android|ios|iphone|mobile/.test(platform)) return "mobile";
  if (type.includes("external") || e.external === true) return "external";
  return "main";
}

function isUpdated(e) {
  return e.updateStatus === true || e.updateStatus === "true";
}

function priceText(e) {
  if (e.free === true) return "Free";
  if (e.cost) return String(e.cost).startsWith("$") ? e.cost : `$${e.cost}`;
  return null;
}

function line(e) {
  const name = e.title || e.name || "Unknown";
  const parts = [isUpdated(e) ? "Updated" : "Not updated"];
  if (e.detected === true) parts.push("Detected");
  const price = priceText(e);
  if (price) parts.push(price);
  if (e.version) parts.push(`v${e.version}`);
  return `**${name}** - ${parts.join(" | ")}`;
}

const PAGES = { main: "Main", mobile: "Mobile", external: "External" };

function buildEmbed(key, groups) {
  const items = groups[key];
  let desc = "";
  let shown = 0;
  for (const e of items) {
    const l = line(e) + "\n";
    if (desc.length + l.length > 3800) break;
    desc += l;
    shown++;
  }
  if (shown < items.length) desc += `+${items.length - shown} more`;
  return new EmbedBuilder()
    .setTitle(`Executor status - ${PAGES[key]}`)
    .setDescription(desc || "No executors found in this category.")
    .setColor(0xff3b4e)
    .setFooter({ text: `${items.length} listed - data from whatexpsare.online` })
    .setTimestamp();
}

function buildRow(active, disabled = false) {
  return new ActionRowBuilder().addComponents(
    Object.keys(PAGES).map((k) =>
      new ButtonBuilder()
        .setCustomId(`autoexec_${k}`)
        .setLabel(PAGES[k])
        .setStyle(k === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(disabled)
    )
  );
}

// ---------- Bot ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

// ---------- Status change announcements ----------
const POLL_MS = 3 * 60 * 1000;
let lastStatus = null;

const keyOf = (e) => `${e.title || e.name}|${e.platform || ""}`;

function changeEmbed(e) {
  const up = isUpdated(e);
  const details = [`Category: ${PAGES[category(e)]}`];
  if (e.platform) details.push(`Platform: ${e.platform}`);
  if (e.version) details.push(`Version: ${e.version}`);
  if (e.detected === true) details.push("Detected: Yes");
  const price = priceText(e);
  if (price) details.push(`Price: ${price}`);
  return new EmbedBuilder()
    .setTitle(`${e.title || e.name || "Unknown"} is now ${up ? "up to date" : "outdated"}`)
    .setDescription(details.join("\n"))
    .setColor(up ? 0x3ddc84 : 0xff3b4e)
    .setFooter({ text: "via whatexpsare.online" })
    .setTimestamp();
}

async function sendToChannel(embeds) {
  if (!announceChannelId) {
    console.log("Status changed but no channel is set (use /setchannel)");
    return false;
  }
  const ch = await client.channels.fetch(announceChannelId).catch(() => null);
  if (!ch || !ch.isTextBased()) {
    console.error("Announcement channel not found or not text-based");
    return false;
  }
  try {
    await ch.send({ embeds: embeds.slice(0, 10) });
    return true;
  } catch (err) {
    console.error("Failed to send announcement:", err.message);
    return false;
  }
}

async function checkChanges() {
  try {
    const list = await getExploits(true);
    const current = new Map(list.map((e) => [keyOf(e), e]));
    if (lastStatus) {
      const changes = [];
      for (const [k, e] of current) {
        const prev = lastStatus.get(k);
        if (prev !== undefined && prev !== isUpdated(e)) changes.push(e);
      }
      if (changes.length) {
        console.log(`${changes.length} status change(s) detected`);
        await sendToChannel(changes.map(changeEmbed));
      }
    }
    lastStatus = new Map(list.map((e) => [keyOf(e), isUpdated(e)]));
  } catch (err) {
    console.error("Status check failed:", err.message);
  }
}

// ---------- Beta applications ----------
const QUESTIONS = [
  "What's your Discord username?",
  "What's your Roblox username?",
  "Which executor do you use?",
  "Which game will you use Project Select in most (Arsenal, Phantom Forces, MM2, Rivals or Universal)?",
  "Why should you be picked as a beta tester?",
];

const activeApps = new Set(); // people currently answering questions
const applicants = new Set(); // people whose DMs get forwarded to the reviewer

async function runApplication(user, dm) {
  activeApps.add(user.id);
  const answers = [];
  try {
    for (let i = 0; i < QUESTIONS.length; i++) {
      await dm.send(`**Question ${i + 1}/${QUESTIONS.length}**\n${QUESTIONS[i]}`);
      const got = await dm.awaitMessages({
        filter: (m) => m.author.id === user.id,
        max: 1,
        time: 5 * 60 * 1000,
        errors: ["time"],
      });
      const reply = got.first();
      if (reply.content.trim().toLowerCase() === "cancel") {
        await dm.send("Application cancelled.");
        return;
      }
      answers.push(reply.content || "(no text)");
    }
  } catch {
    await dm
      .send("Timed out. Click the button again to restart your application.")
      .catch(() => {});
    return;
  } finally {
    activeApps.delete(user.id);
  }

  applicants.add(user.id);

  try {
    if (!reviewerId) {
      await dm.send("Applications aren't fully set up yet. Please try again later.");
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle("New beta application")
      .setDescription(`From <@${user.id}> (${user.tag})\nUser ID: ${user.id}`)
      .addFields(
        QUESTIONS.map((q, i) => ({
          name: q.slice(0, 250),
          value: (answers[i] || "-").slice(0, 1000),
        }))
      )
      .setColor(0xff3b4e)
      .setTimestamp();
    const reviewer = await client.users.fetch(reviewerId);
    await reviewer.send({ embeds: [embed] });
    await dm.send(
      "Thanks! Your application has been sent. If you're selected, you'll hear from us here."
    );
  } catch (err) {
    console.error("Failed to send application:", err.message);
    await dm
      .send("Something went wrong sending your application. Please try again later.")
      .catch(() => {});
  }
}

async function handleApplyButton(interaction) {
  const user = interaction.user;
  if (activeApps.has(user.id)) {
    return interaction.reply({
      content: "You already have an application in progress. Check your DMs.",
      flags: 64,
    });
  }
  await interaction.deferReply({ flags: 64 });
  let dm;
  try {
    dm = await user.createDM();
    await dm.send(
      "Hi! Thanks for applying to the Project Select beta. I'll ask a few questions, one at a time. Type `cancel` at any time to stop.\n\nYour answers, and any messages you send me here, are shared with the Project Select team."
    );
  } catch {
    return interaction.editReply(
      "I couldn't DM you. Turn on DMs from server members in the server's privacy settings, then click the button again."
    );
  }
  await interaction.editReply("Check your DMs.");
  runApplication(user, dm);
}

// Forward DMs from applicants to the reviewer
client.on("messageCreate", async (m) => {
  try {
    if (m.author.bot || m.guildId) return;
    if (activeApps.has(m.author.id)) return;
    if (!applicants.has(m.author.id) || !reviewerId) return;
    const files = [...m.attachments.values()].map((a) => a.url).join("\n");
    const embed = new EmbedBuilder()
      .setTitle(`Message from ${m.author.tag}`)
      .setDescription(((m.content || "") + (files ? `\n${files}` : "")).slice(0, 4000) || "(empty)")
      .setFooter({ text: `User ID: ${m.author.id} - reply with /betaset` })
      .setColor(0x8a8a99)
      .setTimestamp();
    const reviewer = await client.users.fetch(reviewerId);
    await reviewer.send({ embeds: [embed] });
  } catch (err) {
    console.error("Failed to forward DM:", err.message);
  }
});

// ---------- Commands ----------
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

  new SlashCommandBuilder()
    .setName("autoexec")
    .setDescription("See current executor statuses (Main, Mobile, External)"),

  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Send executor status announcements to this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("testannounce")
    .setDescription("Send a sample announcement to the announcement channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("betasetup")
    .setDescription("Post the beta application button in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("betaset")
    .setDescription("Message a beta applicant through the bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) =>
      o.setName("user").setDescription("The applicant").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("message")
        .setDescription("What the bot will send them")
        .setRequired(true)
        .setMaxLength(2000)
    )
    .addStringOption((o) =>
      o
        .setName("status")
        .setDescription("Label for this update")
        .addChoices(
          { name: "Accepted", value: "Accepted" },
          { name: "Declined", value: "Declined" },
          { name: "Update", value: "Update" }
        )
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

  // Start watching executor statuses
  checkChanges();
  setInterval(checkChanges, POLL_MS);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === "beta_apply") {
        return handleApplyButton(interaction);
      }
      return; // autoexec buttons are handled by their own collector
    }

    if (!interaction.isChatInputCommand()) return;

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

    if (interaction.commandName === "setchannel") {
      announceChannelId = interaction.channelId;
      try {
        fs.writeFileSync(CHANNEL_FILE, JSON.stringify({ id: announceChannelId }));
      } catch (err) {
        console.error("Couldn't save channel file:", err.message);
      }
      return interaction.reply({
        content:
          `Executor status announcements will now go to this channel.\n\n` +
          `To keep this after restarts or redeploys, add a Fly secret named ANNOUNCE_CHANNEL_ID with the value ${announceChannelId}`,
        flags: 64,
      });
    }

    if (interaction.commandName === "testannounce") {
      const sample = changeEmbed({
        title: "Sample Executor",
        platform: "Windows",
        version: "1.0",
        updateStatus: true,
      });
      const ok = await sendToChannel([sample]);
      return interaction.reply({
        content: ok
          ? "Sent a test announcement."
          : "Couldn't send. Use /setchannel first, and make sure the bot can view and send messages and embeds in that channel.",
        flags: 64,
      });
    }

    if (interaction.commandName === "betasetup") {
      reviewerId = interaction.user.id;
      try {
        fs.writeFileSync(BETA_FILE, JSON.stringify({ reviewerId }));
      } catch (err) {
        console.error("Couldn't save beta file:", err.message);
      }
      const panel = new EmbedBuilder()
        .setTitle("Project Select Beta")
        .setDescription(
          "Want to be selected as a beta tester? Click the button below and I'll DM you a few questions."
        )
        .setColor(0xff3b4e);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("beta_apply")
          .setLabel("DM Applications!")
          .setStyle(ButtonStyle.Primary)
      );
      try {
        await interaction.channel.send({ embeds: [panel], components: [row] });
      } catch (err) {
        console.error("Couldn't post panel:", err.message);
        return interaction.reply({
          content:
            "Couldn't post in this channel. Give the bot View Channel, Send Messages and Embed Links here.",
          flags: 64,
        });
      }
      return interaction.reply({
        content:
          `Application panel posted. Applications will be sent to you in DMs.\n\n` +
          `To keep this after restarts or redeploys, add a Fly secret named OWNER_ID with the value ${reviewerId}`,
        flags: 64,
      });
    }

    if (interaction.commandName === "betaset") {
      const target = interaction.options.getUser("user");
      const message = interaction.options.getString("message");
      const status = interaction.options.getString("status") || "Update";
      const colors = { Accepted: 0x3ddc84, Declined: 0xff3b4e, Update: 0x8a8a99 };
      const embed = new EmbedBuilder()
        .setTitle(`Beta application: ${status}`)
        .setDescription(message.slice(0, 4000))
        .setColor(colors[status] || 0x8a8a99)
        .setFooter({ text: "Project Select beta team - reply here to talk to us" })
        .setTimestamp();
      try {
        await target.send({ embeds: [embed] });
        applicants.add(target.id);
        return interaction.reply({
          content: `Sent to ${target.tag}. If they reply to the bot, you'll get it in your DMs.`,
          flags: 64,
        });
      } catch {
        return interaction.reply({
          content: `Couldn't DM ${target.tag}. They may have DMs closed.`,
          flags: 64,
        });
      }
    }

    if (interaction.commandName === "autoexec") {
      await interaction.deferReply();

      const groups = { main: [], mobile: [], external: [] };
      try {
        const list = await getExploits();
        list.forEach((e) => groups[category(e)].push(e));
        Object.values(groups).forEach((g) =>
          g.sort(
            (a, b) =>
              Number(isUpdated(b)) - Number(isUpdated(a)) ||
              String(a.title || "").localeCompare(String(b.title || ""))
          )
        );
      } catch (err) {
        console.error("WEAO fetch failed:", err);
        return interaction.editReply(
          "Couldn't fetch executor statuses right now. Try again in a bit."
        );
      }

      let current = "main";
      const msg = await interaction.editReply({
        embeds: [buildEmbed(current, groups)],
        components: [buildRow(current)],
      });

      const collector = msg.createMessageComponentCollector({ time: 120000 });

      collector.on("collect", async (i) => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({
            content: "Run /autoexec to get your own.",
            flags: 64,
          });
        }
        current = i.customId.replace("autoexec_", "");
        await i.update({
          embeds: [buildEmbed(current, groups)],
          components: [buildRow(current)],
        });
      });

      collector.on("end", () => {
        interaction
          .editReply({ components: [buildRow(current, true)] })
          .catch(() => {});
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
