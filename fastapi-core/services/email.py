import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from loguru import logger

from config import settings


async def send_contact_email(name: str, email: str, subject: str, message: str) -> bool:
    """
    Envía un email de contacto a la dirección configurada.
    """
    try:
        # Crear mensaje
        msg = MIMEMultipart()
        msg['From'] = settings.smtp_username
        msg['To'] = settings.contact_email
        msg['Subject'] = f"Contacto Venzio: {subject}"

        # Cuerpo del email
        body = f"""
Nueva consulta desde el formulario de contacto de Venzio:

Nombre: {name}
Email: {email}
Asunto: {subject}

Mensaje:
{message}

---
Este mensaje fue enviado desde el formulario de contacto de Venzio.
"""

        msg.attach(MIMEText(body, 'plain'))

        # Conectar al servidor SMTP
        server = smtplib.SMTP(settings.smtp_server, settings.smtp_port)
        server.starttls()
        server.login(settings.smtp_username, settings.smtp_password)

        # Enviar email
        text = msg.as_string()
        server.sendmail(settings.smtp_username, settings.contact_email, text)
        server.quit()

        logger.info(f"Email de contacto enviado exitosamente a {settings.contact_email}")
        return True

    except Exception as e:
        logger.error(f"Error enviando email de contacto: {e}")
        return False