const express = require('express');
const cron = require('node-cron');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// ⚙️ CONFIGURACIÓN
// ============================================
const FIREBASE_PROJECT_ID = 'la-despensa-46f5f';

// 📧 CONFIGURACIÓN EmailJS - IMPORTANTE: Usar API PRIVADA
const EMAILJS_SERVICE_ID = 'service_cnriqls';
const EMAILJS_TEMPLATE_ID = 'template_auzavs5';
const EMAILJS_PUBLIC_KEY = 'TZAwQh_SmAVCxqk0a';
// ⚠️ NECESITAS TU PRIVATE KEY - La encuentras en:
// https://dashboard.emailjs.com/admin/account
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY || 'QtWDB-9c2zK0vzzFFC9Pz';

// ============================================
// 📧 Enviar Email con EmailJS API PRIVADA
// ============================================
async function sendEmail(userEmail, productName, daysUntil) {
  let message, subject;

  if (daysUntil < 0) {
    subject = `⚠️ Vencido: ${productName}`;
    message = `"${productName}" venció hace ${Math.abs(daysUntil)} día(s).`;
  } else if (daysUntil === 0) {
    subject = `🚨 VENCE HOY: ${productName}`;
    message = `"${productName}" vence HOY!`;
  } else if (daysUntil <= 3) {
    subject = `⏰ Vence pronto: ${productName}`;
    message = `"${productName}" vence en ${daysUntil} día(s).`;
  } else {
    subject = `📅 Recordatorio: ${productName}`;
    message = `"${productName}" vence en ${daysUntil} días.`;
  }

  try {
    // ✅ USAR API PRIVADA - Incluir accessToken en el body
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        // ✅ CLAVE: Agregar accessToken para backend
        accessToken: EMAILJS_PRIVATE_KEY,
        template_params: {
          to_email: userEmail,
          product_name: productName,
          days_until: daysUntil,
          message: message,
          subject: subject,
        },
      }),
    });

    if (response.ok) {
      console.log('✅ Email enviado a:', userEmail);
      return true;
    }
    
    const errorText = await response.text();
    console.error('❌ Error enviando email:', response.status, errorText);
    return false;
    
  } catch (error) {
    console.error('❌ Error:', error.message);
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
    emailjsConfigured: !!EMAILJS_PRIVATE_KEY && EMAILJS_PRIVATE_KEY !== 'TU_PRIVATE_KEY_AQUI'
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
  console.log(`📧 EmailJS: ${EMAILJS_PRIVATE_KEY !== 'TU_PRIVATE_KEY_AQUI' ? 'CONFIGURADO' : 'PENDIENTE'}`);
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
