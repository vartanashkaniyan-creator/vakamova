import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:lang_master/core/app_config.dart';
import 'package:lang_master/data/auth_service.dart';
import 'package:lang_master/data/lang_manager.dart';
import 'package:lang_master/data/sync_service.dart';
import 'package:lang_master/ui/widgets/custom_bar.dart';
import 'package:lang_master/ui/widgets/progress_bar.dart';

/// 👤 **Enterprise Profile Page**
/// صفحه پروفایل کامل با مدیریت حساب و تنظیمات
class ProfilePage extends StatefulWidget {
  const ProfilePage({Key? key}) : super(key: key);

  @override
  _ProfilePageState createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> with SingleTickerProviderStateMixin {
  // Animation
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  
  // State
  bool _isEditing = false;
  Map<String, dynamic> _editData = {};
  bool _isLoading = false;
  
  // Services
  late AuthService _authService;
  late LanguageManager _langManager;
  late SyncService _syncService;
  
  // Profile sections
  final List<ProfileSection> _sections = [];
  
  // ==================== [LIFECYCLE] ====================
  
  @override
  void initState() {
    super.initState();
    
    _initAnimations();
    _loadProfileData();
  }
  
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    
    _authService = Provider.of<AuthService>(context, listen: false);
    _langManager = Provider.of<LanguageManager>(context, listen: false);
    _syncService = Provider.of<SyncService>(context, listen: false);
  }
  
  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }
  
  // ==================== [ANIMATIONS] ====================
  
  void _initAnimations() {
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _animationController,
        curve: Curves.easeInOut,
      ),
    );
    
    _animationController.forward();
  }
  
  // ==================== [DATA LOADING] ====================
  
  Future<void> _loadProfileData() async {
    setState(() => _isLoading = true);
    
    try {
      await Future.delayed(Duration(milliseconds: 300));
      
      // Initialize sections
      _sections.clear();
      _sections.addAll([
        _buildPersonalInfoSection(),
        _buildLearningStatsSection(),
        _buildSubscriptionSection(),
        _buildSettingsSection(),
        _buildSupportSection(),
      ]);
      
    } catch (e) {
      print('Profile data loading error: $e');
    } finally {
      setState(() => _isLoading = false);
    }
  }
  
  ProfileSection _buildPersonalInfoSection() {
    final user = _authService.currentUser;
    
    return ProfileSection(
      title: _langManager.translate('personal_info'),
      icon: Icons.person,
      items: [
        ProfileItem(
          title: _langManager.translate('full_name'),
          value: user?.fullName ?? _langManager.translate('not_set'),
          editable: true,
          field: 'full_name',
          icon: Icons.badge,
        ),
        ProfileItem(
          title: _langManager.translate('email'),
          value: user?.email ?? _langManager.translate('not_set'),
          editable: !user!.isGuest,
          field: 'email',
          icon: Icons.email,
        ),
        ProfileItem(
          title: _langManager.translate('phone'),
          value: user.phone ?? _langManager.translate('not_set'),
          editable: true,
          field: 'phone',
          icon: Icons.phone,
        ),
        ProfileItem(
          title: _langManager.translate('join_date'),
          value: user.createdAt.toString().split(' ')[0],
          editable: false,
          icon: Icons.calendar_today,
        ),
      ],
    );
  }
  
  ProfileSection _buildLearningStatsSection() {
    // TODO: Load actual stats
    final stats = {
      'streak_days': 7,
      'total_xp': 1250,
      'level': 3,
      'lessons_completed': 24,
      'words_learned': 150,
      'time_spent': 1250,
      'accuracy': 87,
    };
    
    return ProfileSection(
      title: _langManager.translate('learning_stats'),
      icon: Icons.analytics,
      items: [
        ProfileItem(
          title: _langManager.translate('current_level'),
          value: 'Level ${stats['level']}',
          editable: false,
          icon: Icons.auto_awesome,
          trailing: Chip(
            label: Text('${stats['level_progress'] ?? 65}%'),
            backgroundColor: Colors.blue[100],
          ),
        ),
        ProfileItem(
          title: _langManager.translate('streak'),
          value: '${stats['streak_days']} ${_langManager.translate('days')}',
          editable: false,
          icon: Icons.local_fire_department,
          trailing: stats['streak_days'] > 0
              ? Icon(Icons.whatshot, color: Colors.orange)
              : null,
        ),
        ProfileItem(
          title: _langManager.translate('total_xp'),
          value: '${stats['total_xp']} XP',
          editable: false,
          icon: Icons.emoji_events,
        ),
        ProfileItem(
          title: _langManager.translate('lessons_completed'),
          value: '${stats['lessons_completed']}',
          editable: false,
          icon: Icons.check_circle,
        ),
        ProfileItem(
          title: _langManager.translate('time_spent'),
          value: '${stats['time_spent']} ${_langManager.translate('minutes')}',
          editable: false,
          icon: Icons.timer,
        ),
      ],
    );
  }
  
  ProfileSection _buildSubscriptionSection() {
    final user = _authService.currentUser;
    final hasSubscription = user?.hasSubscription ?? false;
    final expiry = user?.subscriptionExpiry;
    
    return ProfileSection(
      title: _langManager.translate('subscription'),
      icon: Icons.workspace_premium,
      items: [
        ProfileItem(
          title: _langManager.translate('status'),
          value: hasSubscription
              ? _langManager.translate('active')
              : _langManager.translate('free_tier'),
          editable: false,
          icon: hasSubscription ? Icons.verified : Icons.free_breakfast,
          trailing: hasSubscription
              ? Chip(
                  label: Text(_langManager.translate('pro')),
                  backgroundColor: Colors.green[100],
                )
              : null,
        ),
        if (hasSubscription && expiry != null)
          ProfileItem(
            title: _langManager.translate('expires'),
            value: expiry.toString().split(' ')[0],
            editable: false,
            icon: Icons.calendar_month,
          ),
        ProfileItem(
          title: _langManager.translate('manage_subscription'),
          value: '',
          editable: false,
          icon: Icons.payment,
          isAction: true,
          onTap: _manageSubscription,
        ),
        ProfileItem(
          title: hasSubscription
              ? _langManager.translate('upgrade_plan')
              : _langManager.translate('upgrade_to_pro'),
          value: '',
          editable: false,
          icon: Icons.upgrade,
          isAction: true,
          onTap: _upgradeSubscription,
        ),
      ],
    );
  }
  
  ProfileSection _buildSettingsSection() {
    return ProfileSection(
      title: _langManager.translate('settings'),
      icon: Icons.settings,
      items: [
        ProfileItem(
          title: _langManager.translate('language'),
          value: _langManager.currentLanguageConfig?.name ?? 'English',
          editable: false,
          icon: Icons.language,
          trailing: DropdownButton<String>(
            value: _langManager.currentLanguageConfig?.code,
            onChanged: (value) {
              if (value != null) {
                _changeLanguage(value);
              }
            },
            items: _langManager.availableLanguages.map((lang) {
              return DropdownMenuItem<String>(
                value: lang.code,
                child: Text(lang.name),
              );
            }).toList(),
          ),
        ),
        ProfileItem(
          title: _langManager.translate('notifications'),
          value: '',
          editable: false,
          icon: Icons.notifications,
          isAction: true,
          onTap: _manageNotifications,
        ),
        ProfileItem(
          title: _langManager.translate('privacy_security'),
          value: '',
          editable: false,
          icon: Icons.security,
          isAction: true,
          onTap: _privacySettings,
        ),
        ProfileItem(
          title: _langManager.translate('data_sync'),
          value: _syncService.pendingSyncCount > 0
              ? '${_syncService.pendingSyncCount} pending'
              : 'Up to date',
          editable: false,
          icon: Icons.sync,
          isAction: true,
          onTap: _syncData,
          trailing: _syncService.isSyncing
              ? SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : null,
        ),
        ProfileItem(
          title: _langManager.translate('clear_cache'),
          value: '',
          editable: false,
          icon: Icons.delete_sweep,
          isAction: true,
          onTap: _clearCache,
        ),
      ],
    );
  }
  
  ProfileSection _buildSupportSection() {
    return ProfileSection(
      title: _langManager.translate('support'),
      icon: Icons.help_center,
      items: [
        ProfileItem(
          title: _langManager.translate('help_center'),
          value: '',
          editable: false,
          icon: Icons.help,
          isAction: true,
          onTap: _openHelpCenter,
        ),
        ProfileItem(
          title: _langManager.translate('contact_support'),
          value: '',
          editable: false,
          icon: Icons.support_agent,
          isAction: true,
          onTap: _contactSupport,
        ),
        ProfileItem(
          title: _langManager.translate('rate_app'),
          value: '',
          editable: false,
          icon: Icons.star,
          isAction: true,
          onTap: _rateApp,
        ),
        ProfileItem(
          title: _langManager.translate('about'),
          value: '',
          editable: false,
          icon: Icons.info,
          isAction: true,
          onTap: _showAbout,
        ),
      ],
    );
  }
  
  // ==================== [UI BUILDING] ====================
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.background,
      body: _isLoading
          ? _buildLoadingScreen()
          : _buildMainContent(),
    );
  }
  
  Widget _buildLoadingScreen() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          CircularProgressIndicator(),
          SizedBox(height: 20),
          Text(
            _langManager.translate('loading_profile'),
            style: Theme.of(context).textTheme.titleMedium,
          ),
        ],
      ),
    );
  }
  
  Widget _buildMainContent() {
    return FadeTransition(
      opacity: _fadeAnimation,
      child: CustomScrollView(
        slivers: [
          // App Bar with Profile Header
          SliverAppBar(
            expandedHeight: 200,
            floating: false,
            pinned: true,
            flexibleSpace: _buildProfileHeader(),
            actions: [
              IconButton(
                icon: Icon(_isEditing ? Icons.save : Icons.edit),
                onPressed: _isEditing ? _saveProfile : _startEditing,
                tooltip: _isEditing
                    ? _langManager.translate('save')
                    : _langManager.translate('edit_profile'),
              ),
              IconButton(
                icon: Icon(Icons.more_vert),
                onPressed: _showMoreOptions,
              ),
            ],
          ),
          
          // Profile Content
          SliverList(
            delegate: SliverChildListDelegate([
              // Quick Stats
              _buildQuickStats(),
              
              // Profile Sections
              ..._sections.map((section) => _buildSection(section)),
              
              // Logout Button
              _buildLogoutButton(),
              
              SizedBox(height: 100), // Bottom padding
            ]),
          ),
        ],
      ),
    );
  }
  
  Widget _buildProfileHeader() {
    final user = _authService.currentUser;
    
    return FlexibleSpaceBar(
      title: Text(
        user?.fullName ?? _langManager.translate('profile'),
        style: TextStyle(fontSize: 16),
      ),
      background: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Theme.of(context).colorScheme.primary,
              Theme.of(context).colorScheme.secondary,
            ],
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            SizedBox(height: 60),
            CircleAvatar(
              radius: 50,
              backgroundImage: user?.avatarUrl != null
                  ? NetworkImage(user!.avatarUrl!)
                  : null,
              child: user?.avatarUrl == null
                  ? Icon(Icons.person, size: 50, color: Colors.white)
                  : null,
            ),
            SizedBox(height: 12),
            Text(
              user?.fullName ?? _langManager.translate('guest_user'),
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
            SizedBox(height: 4),
            if (user?.email != null)
              Text(
                user!.email!,
                style: TextStyle(color: Colors.white70),
              ),
            SizedBox(height: 20),
          ],
        ),
      ),
    );
  }
  
  Widget _buildQuickStats() {
    return Card(
      margin: EdgeInsets.all(16),
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _buildStatItem(
              icon: Icons.auto_awesome,
              value: 'Level 3',
              label: _langManager.translate('level'),
            ),
            _buildStatItem(
              icon: Icons.local_fire_department,
              value: '7',
              label: _langManager.translate('streak'),
            ),
            _buildStatItem(
              icon: Icons.emoji_events,
              value: '1250',
              label: _langManager.translate('xp'),
            ),
            _buildStatItem(
              icon: Icons.timer,
              value: '20h',
              label: _langManager.translate('time'),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildStatItem({
    required IconData icon,
    required String value,
    required String label,
  }) {
    return Column(
      children: [
        Container(
          padding: EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.primary.withOpacity(0.1),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: Theme.of(context).colorScheme.primary),
        ),
        SizedBox(height: 8),
        Text(
          value,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
        ),
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: Colors.grey[600],
          ),
        ),
      ],
    );
  }
  
  Widget _buildSection(ProfileSection section) {
    return Card(
      margin: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Section Header
            Row(
              children: [
                Icon(section.icon, color: Theme.of(context).colorScheme.primary),
                SizedBox(width: 12),
                Text(
                  section.title,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            SizedBox(height: 16),
            
            // Section Items
            ...section.items.map((item) => _buildProfileItem(item)),
          ],
        ),
      ),
    );
  }
  
  Widget _buildProfileItem(ProfileItem item) {
    return Column(
      children: [
        ListTile(
          leading: Icon(item.icon, color: Colors.grey[600]),
          title: Text(item.title),
          subtitle: item.value.isNotEmpty && !item.isAction
              ? Text(item.value)
              : null,
          trailing: _isEditing && item.editable
              ? SizedBox(
                  width: 150,
                  child: TextFormField(
                    initialValue: _editData[item.field] ?? item.value,
                    onChanged: (value) => _editData[item.field] = value,
                    decoration: InputDecoration(
                      border: OutlineInputBorder(),
                      contentPadding: EdgeInsets.symmetric(horizontal: 8),
                    ),
                  ),
                )
              : item.tragging ?? (item.isAction ? Icon(Icons.chevron_right) : null),
          onTap: item.isAction ? item.onTap : null,
        ),
        Divider(height: 1),
      ],
    );
  }
  
  Widget _buildLogoutButton() {
    return Container(
      margin: EdgeInsets.all(16),
      child: ElevatedButton.icon(
        icon: Icon(Icons.logout),
        label: Text(
          _authService.isGuest
              ? _langManager.translate('delete_guest_data')
              : _langManager.translate('logout'),
        ),
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.red,
          foregroundColor: Colors.white,
          minimumSize: Size(double.infinity, 56),
        ),
        onPressed: _confirmLogout,
      ),
    );
  }
  
  // ==================== [ACTIONS] ====================
  
  void _startEditing() {
    setState(() => _isEditing = true);
    
    // Initialize edit data
    final user = _authService.currentUser;
    _editData = {
      'full_name': user?.fullName,
      'email': user?.email,
      'phone': user?.phone,
    };
  }
  
  Future<void> _saveProfile() async {
    setState(() => _isLoading = true);
    
    try {
      // Update via API
      await _authService.updateUserProfile(_editData);
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_langManager.translate('profile_updated'))),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Update failed: $e')),
      );
    } finally {
      setState(() {
        _isLoading = false;
        _isEditing = false;
        _editData.clear();
      });
      
      // Reload data
      await _loadProfileData();
    }
  }
  
  Future<void> _changeLanguage(String languageCode) async {
    try {
      await _langManager.changeLanguage(languageCode);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_langManager.translate('language_changed'))),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Language change failed: $e')),
      );
    }
  }
  
  Future<void> _manageSubscription() async {
    // TODO: Navigate to subscription management
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_langManager.translate('subscription_management')),
        content: Text(_langManager.translate('subscription_management_desc')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(_langManager.translate('close')),
          ),
        ],
      ),
    );
  }
  
  Future<void> _upgradeSubscription() async {
    // TODO: Navigate to subscription plans
  }
  
  Future<void> _manageNotifications() async {
    // TODO: Navigate to notification settings
  }
  
  Future<void> _privacySettings() async {
    // TODO: Navigate to privacy settings
  }
  
  Future<void> _syncData() async {
    final result = await _syncService.syncAll();
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(result.success
            ? _langManager.translate('sync_completed')
            : result.error ?? _langManager.translate('sync_failed')),
        backgroundColor: result.success ? Colors.green : Colors.red,
      ),
    );
  }
  
  Future<void> _clearCache() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_langManager.translate('clear_cache')),
        content: Text(_langManager.translate('clear_cache_confirm')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(_langManager.translate('cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(_langManager.translate('clear'), style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    
    if (confirmed == true) {
      // TODO: Clear cache
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_langManager.translate('cache_cleared'))),
      );
    }
  }
  
  Future<void> _openHelpCenter() async {
    // TODO: Open help center
  }
  
  Future<void> _contactSupport() async {
    // TODO: Open contact form
  }
  
  Future<void> _rateApp() async {
    // TODO: Open app store rating
  }
  
  Future<void> _showAbout() async {
    showAboutDialog(
      context: context,
      applicationName: AppConfig.appName,
      applicationVersion: AppConfig.appVersion,
      applicationLegalese: '© 2024 LangMaster. All rights reserved.',
      children: [
        SizedBox(height: 16),
        Text(_langManager.translate('about_description')),
      ],
    );
  }
  
  void _showMoreOptions() {
    showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(Icons.share),
              title: Text(_langManager.translate('share_app')),
              onTap: () {
                Navigator.pop(context);
                _shareApp();
              },
            ),
            ListTile(
              leading: Icon(Icons.backup),
              title: Text(_langManager.translate('backup_data')),
              onTap: () {
                Navigator.pop(context);
                _backupData();
              },
            ),
            ListTile(
              leading: Icon(Icons.restore),
              title: Text(_langManager.translate('restore_data')),
              onTap: () {
                Navigator.pop(context);
                _restoreData();
              },
            ),
            Divider(),
            ListTile(
              leading: Icon(Icons.developer_mode),
              title: Text(_langManager.translate('developer_options')),
              onTap: () {
                Navigator.pop(context);
                _developerOptions();
              },
            ),
          ],
        ),
      ),
    );
  }
  
  Future<void> _confirmLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          _authService.isGuest
              ? _langManager.translate('delete_guest_data')
              : _langManager.translate('logout'),
        ),
        content: Text(
          _authService.isGuest
              ? _langManager.translate('delete_guest_data_confirm')
              : _langManager.translate('logout_confirm'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(_langManager.translate('cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              _authService.isGuest
                  ? _langManager.translate('delete')
                  : _langManager.translate('logout'),
              style: TextStyle(color: Colors.red),
            ),
          ),
        ],
      ),
    );
    
    if (confirmed == true) {
      await _authService.logout();
      Navigator.pushNamedAndRemoveUntil(context, '/', (route) => false);
    }
  }
  
  Future<void> _shareApp() async {
    // TODO: Implement share functionality
  }
  
  Future<void> _backupData() async {
    // TODO: Implement backup
  }
  
  Future<void> _restoreData() async {
    // TODO: Implement restore
  }
  
  Future<void> _developerOptions() async {
    // TODO: Developer options
  }
}

// ==================== [SUPPORTING CLASSES] ====================

class ProfileSection {
  final String title;
  final IconData icon;
  final List<ProfileItem> items;
  
  ProfileSection({
    required this.title,
    required this.icon,
    required this.items,
  });
}

class ProfileItem {
  final String title;
  final String value;
  final IconData icon;
  final bool editable;
  final bool isAction;
  final String? field;
  final Widget? trailing;
  final VoidCallback? onTap;
  
  ProfileItem({
    required this.title,
    required this.value,
    required this.icon,
    this.editable = false,
    this.isAction = false,
    this.field,
    this.trailing,
    this.onTap,
  });
}
