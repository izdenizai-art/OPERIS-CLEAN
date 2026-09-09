import { prisma } from './db.js';
import { sendMail } from './mailer.js';

let running = false;

function taskDateTime(date: string, time: string): Date | null {
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

export async function processEmailReminders(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    if (!settings?.smtpEnabled || !settings.reminderEmailEnabled) return;

    const now = Date.now();
    const windowEnd = now + Math.max(1, settings.reminderLeadMinutes) * 60_000;
    const tasks = await prisma.task.findMany({ where: { completed: false } });
    const users = await prisma.user.findMany({ where: { active: true, email: { not: null } } });

    for (const task of tasks) {
      const target = taskDateTime(task.date, task.time);
      if (!target) continue;
      const targetMs = target.getTime();
      if (targetMs < now || targetMs > windowEnd) continue;

      for (const user of users) {
        if (!user.email) continue;
        const reminderKey = `${task.id}:${user.id}:${task.date}:${task.time}:${settings.reminderLeadMinutes}`;
        const alreadySent = await prisma.sentReminder.findUnique({ where: { reminderKey } });
        if (alreadySent) continue;

        const subject = `Yaklaşan iş: ${task.title}`;
        const text = `${task.title}\nTarih: ${task.date}\nSaat: ${task.time}\n${task.description}`;
        await sendMail(user.email, subject, text, `<h2>${task.title}</h2><p><strong>Tarih:</strong> ${task.date}</p><p><strong>Saat:</strong> ${task.time}</p><p>${task.description || ''}</p>`);
        await prisma.sentReminder.create({ data: { taskId: task.id, userId: user.id, reminderKey } });
      }
    }
  } catch (error) {
    console.error('Hatırlatma e-postası hatası:', error);
  } finally {
    running = false;
  }
}

export function startReminderScheduler(): void {
  void processEmailReminders();
  setInterval(() => void processEmailReminders(), 60_000);
}
