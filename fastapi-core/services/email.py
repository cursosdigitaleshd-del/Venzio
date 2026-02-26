import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from loguru import logger

from config import settings


async def send_contact_email(name: str, email: str, subject: str, message: str) -> tuple[bool, str]:
    """
    Envía un email de contacto a la dirección configurada.
    Retorna (éxito, mensaje_error)
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

        # Conectar al servidor SMTP con SSL/TLS
        context = ssl.create_default_context()
        server = smtplib.SMTP_SSL(settings.smtp_server, settings.smtp_port, context=context)
        server.login(settings.smtp_username, settings.smtp_password)

        # Enviar email
        text = msg.as_string()
        server.sendmail(settings.smtp_username, settings.contact_email, text)
        server.quit()

        logger.info(f"Email de contacto enviado exitosamente a {settings.contact_email}")
        return True, ""

    except smtplib.SMTPAuthenticationError as e:
        error_msg = f"Error de autenticación SMTP: {str(e)}"
        logger.error(f"Error enviando email de contacto: {error_msg}")
        return False, "Credenciales incorrectas. Verifica usuario y contraseña."

    except smtplib.SMTPConnectError as e:
        error_msg = f"Error de conexión SMTP: {str(e)}"
        logger.error(f"Error enviando email de contacto: {error_msg}")
        return False, "No se pudo conectar al servidor de email."

    except Exception as e:
        error_msg = f"Error enviando email de contacto: {str(e)}"
        logger.error(error_msg)
        return False, "Error interno del servidor de email."
