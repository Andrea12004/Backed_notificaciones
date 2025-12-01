const express = require('express');
const cron = require('node-cron');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// ⚙️ CONFIGURACIÓN
// ============================================
const FIREBASE_PROJECT_ID = 'la-despensa-46f5f';

// 📧 CONFIGURACIÓN Gmail (Nodemailer)
const EMAIL_USER = process.env.EMAIL_USER || 'cardonaandrea644@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS;

// Validar que existan las credenciales
if (!EMAIL_PASS) {
  console.error('⚠️ ADVERTENCIA: EMAIL_PASS no está configurado en las variables de entorno');
}

// Crear transporter de Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

// Verificar configuración al inicio
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Error configuración email:', error.message);
  } else {
    console.log('✅ Servidor de email listo para enviar');
  }
});

// ============================================
// 📧 Enviar Email con Nodemailer
// ============================================
async function sendEmail(userEmail, productName, daysUntil) {
  let message, subject, emoji;

  if (daysUntil < 0) {
    subject = `⚠️ Producto Vencido - Mi Despensa`;
    emoji = '⚠️';
    message = `Tu producto "${productName}" venció hace ${Math.abs(daysUntil)} día(s).`;
  } else if (daysUntil === 0) {
    subject = `🚨 ¡Vence HOY! - Mi Despensa`;
    emoji = '🚨';
    message = `¡Tu producto "${productName}" vence HOY!`;
  } else if (daysUntil <= 3) {
    subject = `⏰ Próximo a Vencer - Mi Despensa`;
    emoji = '⏰';
    message = `Tu producto "${productName}" vence en ${daysUntil} día(s).`;
  } else {
    subject = `📅 Recordatorio de Vencimiento - Mi Despensa`;
    emoji = '📅';
    message = `Tu producto "${productName}" vence en ${daysUntil} días.`;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; background: #f5f5dc; padding: 20px; }
        .container { background: white; padding: 40px; border-radius: 15px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #365c36; }
        .emoji { font-size: 64px; margin-bottom: 10px; }
        .logo { color: #365c36; font-size: 32px; font-weight: bold; margin-bottom: 10px; }
        .message-box { background: #f5f5f5; padding: 24px; border-radius: 10px; margin: 20px 0; }
        .product-name { font-size: 24px; font-weight: bold; color: #365c36; margin-bottom: 10px; }
        .message { font-size: 18px; color: #333; line-height: 1.6; margin-top: 10px; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #888; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="emoji">${emoji}</div>
          <div class="logo">🏪 Mi Despensa</div>
        </div>
        <div class="message-box">
          <div class="product-name">📦 ${productName}</div>
          <div class="message">${message}</div>
        </div>
        <div class="footer">
          <p><strong>Mi Despensa</strong> - Tu asistente de cocina inteligente</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"Mi Despensa 🏪" <${EMAIL_USER}>`,
    to: userEmail,
    subject: subject,
    text: message,
    html: htmlContent
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email enviado:', userEmail, '| ID:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Error enviando email:', error.message);
    return false;
  }
}

// ============================================
// 📦 Obtener TODOS los productos de Firestore
// ============================================
async function getProductos() {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/productos`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error('Error obteniendo productos:', response.status);
      return [];
    }

    const data = await response.json();
    
    if (!data.documents) {
      console.log('No hay documentos en la colección productos');
      return [];
    }

    const productos = data.documents.map(doc => {
      const fields = doc.fields || {};
      return {
        userId: fields.userId?.stringValue || '',
        userEmail: fields.userEmail?.stringValue || '',
        name: fields.name?.stringValue || '',
        expire_date: fields.expire_date?.stringValue || '',
      };
    });

    return productos;
  } catch (error) {
    console.error('Error en getProductos:', error.message);
    return [];
  }
}

// ============================================
// 👤 Obtener email de un usuario por UID
// ============================================
async function getUserEmail(userId) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/usuarios/${userId}`;
    
    const response = await fetch(url);
    
    if (response.ok) {
      const data = await response.json();
      return data.fields?.email?.stringValue || null;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// ============================================
// 🔍 VERIFICAR PRODUCTOS (Función Principal)
// ============================================
async function verificarProductos() {
  console.log('\n═══════════════════════════════════════');
  console.log('🔍 INICIANDO VERIFICACIÓN');
  console.log('Hora:', new Date().toLocaleString('es-CO'));
  console.log('═══════════════════════════════════════');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const productos = await getProductos();
    console.log(`📦 ${productos.length} productos encontrados en Firestore`);

    if (productos.length === 0) {
      console.log('⚠️ No hay productos en la base de datos');
      return;
    }

    // Agrupar productos por userId
    const productosPorUsuario = {};
    
    productos.forEach(p => {
      if (!p.userId) return;
      
      if (!productosPorUsuario[p.userId]) {
        productosPorUsuario[p.userId] = {
          email: p.userEmail || null,
          productos: []
        };
      }
      productosPorUsuario[p.userId].productos.push(p);
    });

    console.log(`👥 ${Object.keys(productosPorUsuario).length} usuarios únicos encontrados`);

    let totalEmails = 0;

    // Para cada usuario
    for (const [userId, userData] of Object.entries(productosPorUsuario)) {
      let userEmail = userData.email;
      
      if (!userEmail) {
        userEmail = await getUserEmail(userId);
      }

      if (!userEmail) {
        console.log(`⚠️ Usuario ${userId} sin email - saltando`);
        continue;
      }

      console.log(`\n👤 Usuario: ${userEmail}`);
      console.log(`   Productos: ${userData.productos.length}`);

      // Verificar cada producto del usuario
      for (const producto of userData.productos) {
        if (!producto.expire_date) continue;

        const [year, month, day] = producto.expire_date.split('-').map(Number);
        const expireDate = new Date(year, month - 1, day);
        expireDate.setHours(0, 0, 0, 0);

        const daysUntil = Math.floor((expireDate - today) / (1000 * 60 * 60 * 24));

        // ✅ Notificar en estos días específicos
        const shouldNotify = 
          daysUntil === 7 ||
          daysUntil === 3 ||
          daysUntil === 1 ||
          daysUntil === 0 ||
          daysUntil === -1 ||
          daysUntil === -3;

        if (shouldNotify) {
          console.log(`   📧 Enviando: ${producto.name} (${daysUntil} días)`);
          
          const success = await sendEmail(userEmail, producto.name, daysUntil);
          
          if (success) {
            totalEmails++;
          }
          
          // Pausa entre emails
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    console.log('\n═══════════════════════════════════════');
    console.log(`✅ COMPLETADO - ${totalEmails} emails enviados`);
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ ERROR:', error.message);
  }
}

// ============================================
// ⏰ CRON: Todos los días a las 8:00 AM
// ============================================
cron.schedule('0 8 * * *', () => {
  console.log('\n⏰ CRON EJECUTADO - Verificación automática');
  verificarProductos();
}, {
  timezone: "America/Bogota"
});

// ============================================
// 🌐 ENDPOINTS
// ============================================
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK',
    mensaje: 'Backend Mi Despensa funcionando',
    hora: new Date().toLocaleString('es-CO'),
    proximaVerificacion: '8:00 AM diario',
    emailConfigured: !!EMAIL_PASS
  });
});

app.get('/verificar-ahora', async (req, res) => {
  console.log('🔍 Verificación manual solicitada');
  verificarProductos();
  res.json({ mensaje: 'Verificación iniciada - revisa los logs' });
});

app.get('/test-email', async (req, res) => {
  const testEmail = req.query.email || 'test@example.com';
  console.log('📧 Enviando email de prueba a:', testEmail);
  
  const success = await sendEmail(testEmail, 'Producto de Prueba', 3);
  
  res.json({ 
    success,
    mensaje: success ? 'Email enviado correctamente' : 'Error enviando email',
    email: testEmail
  });
});

app.get('/ping', (req, res) => {
  res.json({ pong: true, hora: new Date().toISOString() });
});

// ============================================
// 🚀 INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
  console.log('\n═══════════════════════════════════════');
  console.log('🚀 SERVIDOR INICIADO');
  console.log(`📍 Puerto: ${PORT}`);
  console.log(`📧 Email: ${EMAIL_PASS ? 'CONFIGURADO ✅' : 'PENDIENTE ⚠️'}`);
  console.log(`⏰ Cron: Diario 8:00 AM (America/Bogota)`);
  console.log('═══════════════════════════════════════\n');
  
  // Verificación inicial (10 segundos después)
  setTimeout(() => {
    console.log('🔍 Verificación inicial (10 segundos)...\n');
    verificarProductos();
  }, 10000);
});

// Auto-ping cada 14 minutos para mantener activo
setInterval(() => {
  console.log('🏓 Auto-ping');
  fetch(`http://localhost:${PORT}/ping`).catch(() => {});
}, 14 * 60 * 1000);
