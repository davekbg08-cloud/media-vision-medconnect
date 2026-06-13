/* =====================================================
   MedConnect 2.0 — i18n Module (10 langues)
   ===================================================== */
const I18n = (() => {
  const LANGUAGES = {
    fr: { name:'Français',   flag:'🇫🇷', dir:'ltr' },
    en: { name:'English',    flag:'🇬🇧', dir:'ltr' },
    es: { name:'Español',    flag:'🇪🇸', dir:'ltr' },
    ar: { name:'العربية',    flag:'🇸🇦', dir:'rtl' },
    pt: { name:'Português',  flag:'🇧🇷', dir:'ltr' },
    sw: { name:'Kiswahili',  flag:'🇰🇪', dir:'ltr' },
    zh: { name:'中文',        flag:'🇨🇳', dir:'ltr' },
    de: { name:'Deutsch',    flag:'🇩🇪', dir:'ltr' },
    ru: { name:'Русский',    flag:'🇷🇺', dir:'ltr' },
    hi: { name:'हिन्दी',      flag:'🇮🇳', dir:'ltr' },
  };

  const T = {
    app_name:       { fr:'MedConnect', en:'MedConnect', es:'MedConnect', ar:'ميدكونكت', pt:'MedConnect', sw:'MedConnect', zh:'MedConnect', de:'MedConnect', ru:'MedConnect', hi:'MedConnect' },
    landing_subtitle: { fr:'Plateforme médicale universelle sécurisée — 195 pays', en:'Secure universal medical platform — 195 countries', es:'Plataforma médica universal segura — 195 países', ar:'منصة طبية عالمية آمنة — 195 دولة', pt:'Plataforma médica universal segura — 195 países', sw:'Jukwaa la matibabu la ulimwengu — nchi 195', zh:'安全的通用医疗平台 — 195个国家', de:'Sichere universelle medizinische Plattform — 195 Länder', ru:'Защищённая универсальная медицинская платформа — 195 стран', hi:'सुरक्षित सार्वभौमिक चिकित्सा प्लेटफ़ॉर्म — 195 देश' },
    portal_patient:   { fr:'Patient', en:'Patient', es:'Paciente', ar:'مريض', pt:'Paciente', sw:'Mgonjwa', zh:'患者', de:'Patient', ru:'Пациент', hi:'रोगी' },
    portal_hospital:  { fr:'Hôpital / Docteur', en:'Hospital / Doctor', es:'Hospital / Doctor', ar:'مستشفى / طبيب', pt:'Hospital / Médico', sw:'Hospitali / Daktari', zh:'医院 / 医生', de:'Krankenhaus / Arzt', ru:'Больница / Врач', hi:'अस्पताल / डॉक्टर' },
    portal_pharmacy:  { fr:'Pharmacie', en:'Pharmacy', es:'Farmacia', ar:'صيدلية', pt:'Farmácia', sw:'Duka la Dawa', zh:'药房', de:'Apotheke', ru:'Аптека', hi:'फार्मेसी' },
    nav_my_record:    { fr:'Ma Fiche', en:'My Record', es:'Mi Ficha', ar:'سجلي', pt:'Minha Ficha', sw:'Rekodi Yangu', zh:'我的档案', de:'Meine Akte', ru:'Моя карта', hi:'मेरा रिकॉर्ड' },
    nav_history:      { fr:'Historique', en:'History', es:'Historial', ar:'السجل', pt:'Histórico', sw:'Historia', zh:'历史记录', de:'Verlauf', ru:'История', hi:'इतिहास' },
    nav_prescriptions:{ fr:'Ordonnances', en:'Prescriptions', es:'Recetas', ar:'الوصفات', pt:'Receitas', sw:'Dawa za Daktari', zh:'处方', de:'Rezepte', ru:'Рецепты', hi:'नुस्खे' },
    nav_map:          { fr:'Carte & GPS', en:'Map & GPS', es:'Mapa & GPS', ar:'الخريطة والـGPS', pt:'Mapa & GPS', sw:'Ramani & GPS', zh:'地图 & GPS', de:'Karte & GPS', ru:'Карта & GPS', hi:'मानचित्र & GPS' },
    nav_dashboard:    { fr:'Tableau de Bord', en:'Dashboard', es:'Panel', ar:'لوحة القيادة', pt:'Painel', sw:'Dashibodi', zh:'仪表板', de:'Dashboard', ru:'Панель', hi:'डैशबोर्ड' },
    nav_patients:     { fr:'Patients', en:'Patients', es:'Pacientes', ar:'المرضى', pt:'Pacientes', sw:'Wagonjwa', zh:'患者', de:'Patienten', ru:'Пациенты', hi:'रोगी' },
    nav_consultations:{ fr:'Consultations', en:'Consultations', es:'Consultas', ar:'الاستشارات', pt:'Consultas', sw:'Mashauriano', zh:'会诊', de:'Konsultationen', ru:'Консультации', hi:'परामर्श' },
    nav_pos:          { fr:'Point de Vente', en:'Point of Sale', es:'Punto de Venta', ar:'نقطة البيع', pt:'Ponto de Venda', sw:'Mahali pa Mauzo', zh:'销售点', de:'Verkaufspunkt', ru:'Точка продажи', hi:'बिक्री बिंदु' },
    nav_inventory:    { fr:'Inventaire', en:'Inventory', es:'Inventario', ar:'المخزون', pt:'Estoque', sw:'Hesabu', zh:'库存', de:'Inventar', ru:'Инвентарь', hi:'इन्वेंट्री' },
    nav_sales_history:{ fr:'Ventes', en:'Sales', es:'Ventas', ar:'المبيعات', pt:'Vendas', sw:'Mauzo', zh:'销售', de:'Verkäufe', ru:'Продажи', hi:'बिक्री' },
    form_firstname:   { fr:'Prénom', en:'First Name', es:'Nombre', ar:'الاسم الأول', pt:'Nome', sw:'Jina la Kwanza', zh:'名字', de:'Vorname', ru:'Имя', hi:'पहला नाम' },
    form_lastname:    { fr:'Nom', en:'Last Name', es:'Apellido', ar:'اسم العائلة', pt:'Sobrenome', sw:'Jina la Ukoo', zh:'姓氏', de:'Nachname', ru:'Фамилия', hi:'अंतिम नाम' },
    form_dob:         { fr:'Date de Naissance', en:'Date of Birth', es:'Fecha de Nacimiento', ar:'تاريخ الميلاد', pt:'Data de Nascimento', sw:'Tarehe ya Kuzaliwa', zh:'出生日期', de:'Geburtsdatum', ru:'Дата рождения', hi:'जन्म तिथि' },
    form_gender:      { fr:'Sexe', en:'Gender', es:'Género', ar:'الجنس', pt:'Gênero', sw:'Jinsia', zh:'性别', de:'Geschlecht', ru:'Пол', hi:'लिंग' },
    form_male:        { fr:'Masculin', en:'Male', es:'Masculino', ar:'ذكر', pt:'Masculino', sw:'Mwanaume', zh:'男', de:'Männlich', ru:'Мужской', hi:'पुरुष' },
    form_female:      { fr:'Féminin', en:'Female', es:'Femenino', ar:'أنثى', pt:'Feminino', sw:'Mwanamke', zh:'女', de:'Weiblich', ru:'Женский', hi:'महिला' },
    form_blood_type:  { fr:'Groupe Sanguin', en:'Blood Type', es:'Tipo de Sangre', ar:'فصيلة الدم', pt:'Tipo Sanguíneo', sw:'Aina ya Damu', zh:'血型', de:'Blutgruppe', ru:'Группа крови', hi:'रक्त प्रकार' },
    form_country:     { fr:'Pays', en:'Country', es:'País', ar:'البلد', pt:'País', sw:'Nchi', zh:'国家', de:'Land', ru:'Страна', hi:'देश' },
    form_phone:       { fr:'Téléphone', en:'Phone', es:'Teléfono', ar:'الهاتف', pt:'Telefone', sw:'Simu', zh:'电话', de:'Telefon', ru:'Телефон', hi:'फोन' },
    form_address:     { fr:'Adresse', en:'Address', es:'Dirección', ar:'العنوان', pt:'Endereço', sw:'Anwani', zh:'地址', de:'Adresse', ru:'Адрес', hi:'पता' },
    form_allergies:   { fr:'Allergies', en:'Allergies', es:'Alergias', ar:'الحساسية', pt:'Alergias', sw:'Mzio', zh:'过敏', de:'Allergien', ru:'Аллергии', hi:'एलर्जी' },
    form_chronic:     { fr:'Maladies Chroniques', en:'Chronic Diseases', es:'Enfermedades Crónicas', ar:'الأمراض المزمنة', pt:'Doenças Crônicas', sw:'Magonjwa ya Kudumu', zh:'慢性疾病', de:'Chronische Krankheiten', ru:'Хронические заболевания', hi:'दीर्घकालिक रोग' },
    weight:           { fr:'Poids (kg)', en:'Weight (kg)', es:'Peso (kg)', ar:'الوزن (كجم)', pt:'Peso (kg)', sw:'Uzito (kg)', zh:'体重 (kg)', de:'Gewicht (kg)', ru:'Вес (кг)', hi:'वजन (kg)' },
    height:           { fr:'Taille (cm)', en:'Height (cm)', es:'Altura (cm)', ar:'الطول (سم)', pt:'Altura (cm)', sw:'Urefu (cm)', zh:'身高 (cm)', de:'Größe (cm)', ru:'Рост (см)', hi:'ऊंचाई (cm)' },
    emergency_contact:{ fr:'Contact d\'urgence', en:'Emergency Contact', es:'Contacto de Emergencia', ar:'جهة اتصال للطوارئ', pt:'Contato de Emergência', sw:'Mawasiliano ya Dharura', zh:'紧急联系人', de:'Notfallkontakt', ru:'Экстренный контакт', hi:'आपातकालीन संपर्क' },
    btn_save:         { fr:'Enregistrer', en:'Save', es:'Guardar', ar:'حفظ', pt:'Salvar', sw:'Hifadhi', zh:'保存', de:'Speichern', ru:'Сохранить', hi:'सहेजें' },
    btn_cancel:       { fr:'Annuler', en:'Cancel', es:'Cancelar', ar:'إلغاء', pt:'Cancelar', sw:'Ghairi', zh:'取消', de:'Abbrechen', ru:'Отмена', hi:'रद्द करें' },
    btn_edit:         { fr:'Modifier', en:'Edit', es:'Editar', ar:'تعديل', pt:'Editar', sw:'Hariri', zh:'编辑', de:'Bearbeiten', ru:'Редактировать', hi:'संपादित करें' },
    btn_delete:       { fr:'Supprimer', en:'Delete', es:'Eliminar', ar:'حذف', pt:'Excluir', sw:'Futa', zh:'删除', de:'Löschen', ru:'Удалить', hi:'हटाएं' },
    btn_print:        { fr:'Imprimer', en:'Print', es:'Imprimir', ar:'طباعة', pt:'Imprimir', sw:'Chapisha', zh:'打印', de:'Drucken', ru:'Печать', hi:'प्रिंट करें' },
    btn_share:        { fr:'Partager', en:'Share', es:'Compartir', ar:'مشاركة', pt:'Compartilhar', sw:'Shiriki', zh:'分享', de:'Teilen', ru:'Поделиться', hi:'साझा करें' },
    btn_new_patient:  { fr:'Nouveau Patient', en:'New Patient', es:'Nuevo Paciente', ar:'مريض جديد', pt:'Novo Paciente', sw:'Mgonjwa Mpya', zh:'新患者', de:'Neuer Patient', ru:'Новый пациент', hi:'नया रोगी' },
    back_home:        { fr:'Déconnexion', en:'Logout', es:'Cerrar sesión', ar:'تسجيل خروج', pt:'Sair', sw:'Toka', zh:'退出', de:'Abmelden', ru:'Выйти', hi:'लॉग आउट' },
    patient_id:       { fr:'N° Unique Patient', en:'Patient Unique ID', es:'N° Único Paciente', ar:'الرقم الفريد للمريض', pt:'N° Único Paciente', sw:'Nambari ya Kipekee', zh:'患者唯一编号', de:'Eindeutige Patienten-Nr.', ru:'Уникальный № пациента', hi:'रोगी अद्वितीय संख्या' },
    create_my_record: { fr:'Créer ma fiche médicale', en:'Create my medical record', es:'Crear mi ficha médica', ar:'إنشاء سجلي الطبي', pt:'Criar minha ficha médica', sw:'Unda rekodi yangu', zh:'创建我的病历', de:'Meine Krankenakte erstellen', ru:'Создать мою медкарту', hi:'मेरा रिकॉर्ड बनाएं' },
    id_generated:     { fr:'ID généré selon votre pays', en:'ID auto-generated by country', es:'ID generado según país', ar:'المعرف يُنشأ حسب البلد', pt:'ID gerado pelo país', sw:'Kitambulisho kizalishwa kiotomatiki', zh:'根据国家自动生成ID', de:'ID wird nach Land generiert', ru:'ID генерируется по стране', hi:'देश के अनुसार ID उत्पन्न' },
    consult_diagnosis:{ fr:'Diagnostic', en:'Diagnosis', es:'Diagnóstico', ar:'التشخيص', pt:'Diagnóstico', sw:'Utambuzi', zh:'诊断', de:'Diagnose', ru:'Диагноз', hi:'निदान' },
    consult_treatment:{ fr:'Traitement', en:'Treatment', es:'Tratamiento', ar:'العلاج', pt:'Tratamento', sw:'Matibabu', zh:'治疗', de:'Behandlung', ru:'Лечение', hi:'उपचार' },
    consult_notes:    { fr:'Notes', en:'Notes', es:'Notas', ar:'ملاحظات', pt:'Notas', sw:'Maelezo', zh:'备注', de:'Notizen', ru:'Заметки', hi:'नोट्स' },
    consult_doctor:   { fr:'Médecin', en:'Doctor', es:'Médico', ar:'الطبيب', pt:'Médico', sw:'Daktari', zh:'医生', de:'Arzt', ru:'Врач', hi:'डॉक्टर' },
    new_consultation: { fr:'Nouvelle Consultation', en:'New Consultation', es:'Nueva Consulta', ar:'استشارة جديدة', pt:'Nova Consulta', sw:'Ushauri Mpya', zh:'新会诊', de:'Neue Konsultation', ru:'Новая консультация', hi:'नई परामर्श' },
    med_name:         { fr:'Médicament', en:'Medicine', es:'Medicamento', ar:'الدواء', pt:'Medicamento', sw:'Dawa', zh:'药品', de:'Medikament', ru:'Лекарство', hi:'दवा' },
    med_price:        { fr:'Prix', en:'Price', es:'Precio', ar:'السعر', pt:'Preço', sw:'Bei', zh:'价格', de:'Preis', ru:'Цена', hi:'कीमत' },
    med_stock:        { fr:'Stock', en:'Stock', es:'Stock', ar:'المخزون', pt:'Estoque', sw:'Akiba', zh:'库存', de:'Bestand', ru:'Запас', hi:'स्टॉक' },
    add_medicine:     { fr:'Ajouter Médicament', en:'Add Medicine', es:'Agregar Medicamento', ar:'إضافة دواء', pt:'Adicionar Medicamento', sw:'Ongeza Dawa', zh:'添加药品', de:'Medikament hinzufügen', ru:'Добавить лекарство', hi:'दवा जोड़ें' },
    sell:             { fr:'Valider la Vente', en:'Confirm Sale', es:'Confirmar Venta', ar:'تأكيد البيع', pt:'Confirmar Venda', sw:'Thibitisha Uuzaji', zh:'确认销售', de:'Verkauf bestätigen', ru:'Подтвердить продажу', hi:'बिक्री की पुष्टि करें' },
    receipt:          { fr:'Panier', en:'Cart', es:'Carrito', ar:'السلة', pt:'Carrinho', sw:'Kikapu', zh:'购物车', de:'Warenkorb', ru:'Корзина', hi:'कार्ट' },
    stat_total_patients:{ fr:'Total Patients', en:'Total Patients', es:'Total Pacientes', ar:'إجمالي المرضى', pt:'Total Pacientes', sw:'Wagonjwa Wote', zh:'患者总数', de:'Patienten gesamt', ru:'Всего пациентов', hi:'कुल रोगी' },
    stat_today:       { fr:'Aujourd\'hui', en:'Today', es:'Hoy', ar:'اليوم', pt:'Hoje', sw:'Leo', zh:'今天', de:'Heute', ru:'Сегодня', hi:'आज' },
    stat_consults:    { fr:'Consultations', en:'Consultations', es:'Consultas', ar:'الاستشارات', pt:'Consultas', sw:'Mashauriano', zh:'会诊', de:'Konsultationen', ru:'Консультации', hi:'परामर्श' },
    stat_sales:       { fr:'Ventes Totales', en:'Total Sales', es:'Ventas Totales', ar:'المبيعات الإجمالية', pt:'Vendas Totais', sw:'Jumla ya Mauzo', zh:'总销售额', de:'Gesamtumsatz', ru:'Общая выручка', hi:'कुल बिक्री' },
    map_title:        { fr:'Établissements de Santé', en:'Health Facilities', es:'Establecimientos de Salud', ar:'المنشآت الصحية', pt:'Estabelecimentos de Saúde', sw:'Vituo vya Afya', zh:'医疗机构', de:'Gesundheitseinrichtungen', ru:'Медицинские учреждения', hi:'स्वास्थ्य सुविधाएं' },
    map_locate:       { fr:'Ma Position GPS', en:'My GPS Location', es:'Mi Posición GPS', ar:'موقعي بالـGPS', pt:'Minha Posição GPS', sw:'Mahali Pangu GPS', zh:'我的GPS位置', de:'Mein GPS-Standort', ru:'Мой GPS', hi:'मेरा GPS स्थान' },
    msg_saved:        { fr:'✅ Enregistré', en:'✅ Saved', es:'✅ Guardado', ar:'✅ تم الحفظ', pt:'✅ Salvo', sw:'✅ Imehifadhiwa', zh:'✅ 已保存', de:'✅ Gespeichert', ru:'✅ Сохранено', hi:'✅ सहेजा गया' },
    msg_deleted:      { fr:'🗑️ Supprimé', en:'🗑️ Deleted', es:'🗑️ Eliminado', ar:'🗑️ تم الحذف', pt:'🗑️ Excluído', sw:'🗑️ Imefutwa', zh:'🗑️ 已删除', de:'🗑️ Gelöscht', ru:'🗑️ Удалено', hi:'🗑️ हटाया गया' },
    msg_no_record:    { fr:'Aucune fiche trouvée.', en:'No record found.', es:'No se encontró registro.', ar:'لم يتم العثور على سجل.', pt:'Nenhum registro encontrado.', sw:'Hakuna rekodi.', zh:'未找到记录。', de:'Kein Datensatz gefunden.', ru:'Запись не найдена.', hi:'कोई रिकॉर्ड नहीं मिला।' },
    msg_confirm_delete:{ fr:'Confirmer la suppression ?', en:'Confirm deletion?', es:'¿Confirmar eliminación?', ar:'تأكيد الحذف؟', pt:'Confirmar exclusão?', sw:'Thibitisha kufuta?', zh:'确认删除？', de:'Löschen bestätigen?', ru:'Подтвердить удаление?', hi:'हटाने की पुष्टि करें?' },
    msg_cart_empty:   { fr:'Panier vide', en:'Cart is empty', es:'Carrito vacío', ar:'السلة فارغة', pt:'Carrinho vazio', sw:'Kikapu kiko wazi', zh:'购物车为空', de:'Warenkorb ist leer', ru:'Корзина пуста', hi:'कार्ट खाली है' },
    msg_low_stock:    { fr:'⚠️ Stock insuffisant', en:'⚠️ Insufficient stock', es:'⚠️ Stock insuficiente', ar:'⚠️ مخزون غير كافٍ', pt:'⚠️ Estoque insuficiente', sw:'⚠️ Akiba haitoshi', zh:'⚠️ 库存不足', de:'⚠️ Unzureichender Bestand', ru:'⚠️ Недостаточный запас', hi:'⚠️ अपर्याप्त स्टॉक' },
    no_data:          { fr:'Aucune donnée', en:'No data', es:'Sin datos', ar:'لا توجد بيانات', pt:'Sem dados', sw:'Hakuna data', zh:'无数据', de:'Keine Daten', ru:'Нет данных', hi:'कोई डेटा नहीं' },
    search_placeholder:{ fr:'Rechercher…', en:'Search…', es:'Buscar…', ar:'بحث…', pt:'Pesquisar…', sw:'Tafuta…', zh:'搜索…', de:'Suchen…', ru:'Поиск…', hi:'खोजें…' },
    total:            { fr:'Total', en:'Total', es:'Total', ar:'المجموع', pt:'Total', sw:'Jumla', zh:'合计', de:'Gesamt', ru:'Итого', hi:'कुल' },
    actions:          { fr:'Actions', en:'Actions', es:'Acciones', ar:'الإجراءات', pt:'Ações', sw:'Vitendo', zh:'操作', de:'Aktionen', ru:'Действия', hi:'कार्रवाई' },
    select_language:  { fr:'Langue', en:'Language', es:'Idioma', ar:'اللغة', pt:'Idioma', sw:'Lugha', zh:'语言', de:'Sprache', ru:'Язык', hi:'भाषा' },
    years:            { fr:'ans', en:'yrs', es:'años', ar:'سنة', pt:'anos', sw:'miaka', zh:'岁', de:'J.', ru:'лет', hi:'वर्ष' },
    search_by_id:     { fr:'Rechercher par N° Unique', en:'Search by Unique ID', es:'Buscar por N° Único', ar:'البحث بالرقم الفريد', pt:'Pesquisar por N° Único', sw:'Tafuta kwa Nambari', zh:'按唯一编号搜索', de:'Nach Nr. suchen', ru:'Поиск по №', hi:'संख्या से खोजें' },
    currency:         { fr:'CDF', en:'USD', es:'USD', ar:'USD', pt:'BRL', sw:'KES', zh:'CNY', de:'EUR', ru:'RUB', hi:'INR' },
    low_stock_alert:  { fr:'Stock bas', en:'Low stock', es:'Stock bajo', ar:'مخزون منخفض', pt:'Estoque baixo', sw:'Akiba ndogo', zh:'库存不足', de:'Niedriger Bestand', ru:'Низкий запас', hi:'कम स्टॉक' },
    patient_found:    { fr:'Patient trouvé', en:'Patient found', es:'Paciente encontrado', ar:'تم العثور على المريض', pt:'Paciente encontrado', sw:'Mgonjwa amepatikana', zh:'找到患者', de:'Patient gefunden', ru:'Пациент найден', hi:'रोगी मिला' },
  };

  let currentLang = localStorage.getItem('mc_lang') || navigator.language.slice(0,2) || 'fr';
  if (!LANGUAGES[currentLang]) currentLang = 'fr';

  function t(key) {
    if (!T[key]) return key;
    return T[key][currentLang] || T[key]['fr'] || key;
  }

  function setLang(lang) {
    if (!LANGUAGES[lang]) return;
    currentLang = lang;
    localStorage.setItem('mc_lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir  = LANGUAGES[lang].dir;
    document.body.classList.toggle('rtl', LANGUAGES[lang].dir === 'rtl');

    // Rafraîchir l'écran actif
    const authScreen = document.getElementById('auth-screen');
    const authVisible = authScreen && authScreen.style.display !== 'none' && authScreen.innerHTML.trim() !== '';

    if (authVisible) {
      // Relancer l'écran de connexion dans la nouvelle langue
      if (window.Auth) Auth.showLogin();
    } else if (window.App) {
      App.refresh();
    }
  }

  function getLang()      { return currentLang; }
  function getLanguages() { return LANGUAGES; }
  function getCurrent()   { return LANGUAGES[currentLang]; }

  function init() {
    document.documentElement.lang = currentLang;
    document.documentElement.dir  = LANGUAGES[currentLang].dir;
    document.body.classList.toggle('rtl', LANGUAGES[currentLang].dir === 'rtl');
  }

  function renderSelector() {
    return `
      <div class="lang-selector">
        <span class="lang-flag">${LANGUAGES[currentLang].flag}</span>
        <select onchange="I18n.setLang(this.value)" title="${t('select_language')}">
          ${Object.entries(LANGUAGES).map(([code, l]) =>
            `<option value="${code}"${code===currentLang?' selected':''}>${l.flag} ${l.name}</option>`
          ).join('')}
        </select>
      </div>`;
  }

  return { t, setLang, getLang, getLanguages, getCurrent, init, renderSelector };
})();

window.I18n = I18n;
