/* =====================================================
   MedConnect 2.0 — Traductions du bundle desktop hôpital
   Enregistrées via I18n.extend(). Couvre d'abord les libellés
   les plus visibles (menu, statuts). À compléter progressivement
   pour les autres chaînes des modules desktop.
   ===================================================== */
(function () {
  if (!window.I18n?.extend) return;

  I18n.extend({
    hd_dashboard:     { fr:'Tableau de bord', en:'Dashboard', es:'Panel', ar:'لوحة القيادة', pt:'Painel', sw:'Dashibodi', zh:'仪表板', de:'Übersicht', ru:'Панель', hi:'डैशबोर्ड' },
    hd_patients:      { fr:'Patients', en:'Patients', es:'Pacientes', ar:'المرضى', pt:'Pacientes', sw:'Wagonjwa', zh:'患者', de:'Patienten', ru:'Пациенты', hi:'रोगी' },
    // Correctif (audit) : clé absente jusqu'ici — le menu et le titre de
    // la route "records" affichaient littéralement "hd_records" (I18n.t
    // retourne la clé elle-même quand elle est introuvable, une chaîne
    // non vide, donc le "|| 'Dossiers médicaux'" ne se déclenchait jamais).
    hd_records:       { fr:'Dossiers médicaux', en:'Medical records', es:'Historial médico', ar:'السجلات الطبية', pt:'Prontuários médicos', sw:'Rekodi za matibabu', zh:'病历', de:'Krankenakten', ru:'Медицинские карты', hi:'चिकित्सा रिकॉर्ड' },
    hd_consultations: { fr:'Consultations', en:'Consultations', es:'Consultas', ar:'الاستشارات', pt:'Consultas', sw:'Mashauriano', zh:'诊疗', de:'Konsultationen', ru:'Консультации', hi:'परामर्श' },
    // Correctif (audit) : ces 4 clés étaient codées en dur en français
    // dans hospital-permissions.js au lieu de passer par L() — le menu
    // restait en français quelle que soit la langue choisie.
    hd_reception:     { fr:'Réception / Accueil', en:'Reception / Front desk', es:'Recepción', ar:'الاستقبال', pt:'Recepção', sw:'Mapokezi', zh:'接待处', de:'Empfang', ru:'Регистратура', hi:'स्वागत' },
    hd_prescriptions: { fr:'Ordonnances', en:'Prescriptions', es:'Recetas', ar:'الوصفات الطبية', pt:'Receitas', sw:'Maagizo ya dawa', zh:'处方', de:'Rezepte', ru:'Рецепты', hi:'नुस्खे' },
    hd_emergency:     { fr:'Urgences', en:'Emergency', es:'Urgencias', ar:'الطوارئ', pt:'Emergências', sw:'Dharura', zh:'急诊', de:'Notaufnahme', ru:'Скорая помощь', hi:'आपातकाल' },
    hd_maternity:     { fr:'Maternité', en:'Maternity', es:'Maternidad', ar:'الولادة', pt:'Maternidade', sw:'Uzazi', zh:'产科', de:'Entbindung', ru:'Роддом', hi:'प्रसूति' },
    hd_beds:          { fr:'Hospitalisation / Lits', en:'Admissions / Beds', es:'Hospitalización / Camas', ar:'الإقامة / الأسرّة', pt:'Internação / Leitos', sw:'Kulazwa / Vitanda', zh:'住院/床位', de:'Aufnahme / Betten', ru:'Госпитализация / Койки', hi:'भर्ती / बिस्तर' },
    hd_doctors:       { fr:'Médecins affiliés', en:'Affiliated doctors', es:'Médicos afiliados', ar:'الأطباء المنتسبون', pt:'Médicos afiliados', sw:'Madaktari washirika', zh:'签约医生', de:'Angeschlossene Ärzte', ru:'Прикреплённые врачи', hi:'संबद्ध डॉक्टर' },
    hd_lab:           { fr:'Laboratoire', en:'Laboratory', es:'Laboratorio', ar:'المختبر', pt:'Laboratório', sw:'Maabara', zh:'实验室', de:'Labor', ru:'Лаборатория', hi:'प्रयोगशाला' },
    hd_pharmacy:      { fr:'Pharmacie', en:'Pharmacy', es:'Farmacia', ar:'الصيدلية', pt:'Farmácia', sw:'Duka la dawa', zh:'药房', de:'Apotheke', ru:'Аптека', hi:'फार्मेसी' },
    hd_ai:            { fr:'IA médicale', en:'Medical AI', es:'IA médica', ar:'الذكاء الاصطناعي الطبي', pt:'IA médica', sw:'AI ya matibabu', zh:'医疗AI', de:'Medizinische KI', ru:'Медицинский ИИ', hi:'चिकित्सा AI' },
    hd_messages:      { fr:'Messagerie', en:'Messages', es:'Mensajería', ar:'الرسائل', pt:'Mensagens', sw:'Ujumbe', zh:'消息', de:'Nachrichten', ru:'Сообщения', hi:'संदेश' },
    hd_subscription:  { fr:'Abonnement', en:'Subscription', es:'Suscripción', ar:'الاشتراك', pt:'Assinatura', sw:'Usajili', zh:'订阅', de:'Abonnement', ru:'Подписка', hi:'सदस्यता' },
    hd_settings:      { fr:'Paramètres', en:'Settings', es:'Ajustes', ar:'الإعدادات', pt:'Configurações', sw:'Mipangilio', zh:'设置', de:'Einstellungen', ru:'Настройки', hi:'सेटिंग्स' },
    hd_back_to_app:   { fr:"Retour à l'application", en:'Back to app', es:'Volver a la app', ar:'العودة إلى التطبيق', pt:'Voltar ao app', sw:'Rudi kwenye programu', zh:'返回应用', de:'Zurück zur App', ru:'Назад в приложение', hi:'ऐप पर वापस' },
    hd_sub_active:    { fr:'Actif', en:'Active', es:'Activo', ar:'نشط', pt:'Ativo', sw:'Inatumika', zh:'有效', de:'Aktiv', ru:'Активен', hi:'सक्रिय' },
    hd_sub_expired:   { fr:'Expiré', en:'Expired', es:'Expirado', ar:'منتهي', pt:'Expirado', sw:'Imeisha', zh:'已过期', de:'Abgelaufen', ru:'Истёк', hi:'समाप्त' },
    hd_sub_grace:     { fr:'Période de grâce', en:'Grace period', es:'Período de gracia', ar:'فترة السماح', pt:'Período de carência', sw:'Kipindi cha neema', zh:'宽限期', de:'Kulanzzeit', ru:'Льготный период', hi:'छूट अवधि' },
  });
})();
