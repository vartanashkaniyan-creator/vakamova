class MainApp : Application() {

    companion object {
        lateinit var ctx: Context
            private set
    }

    override fun onCreate() {
        super.onCreate()
        ctx = applicationContext

        Lang.init(ctx)
        Usr.load(ctx)
        Prg.load(ctx)
    }
}
