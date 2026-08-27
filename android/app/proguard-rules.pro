-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

# Shrinking is ON for release (see build.gradle.kts). Compose, Firebase and kotlinx.serialization
# all ship consumer rules of their own, so the only rules needed here are for the code R8 cannot
# see being used: the contract types, which are reached reflectively by the serializer and by
# Firestore's toObject/`@DocumentId` mapping. Losing a field name to obfuscation here would not
# fail the build — it would produce a job whose fields silently stopped deserialising, which is
# exactly the class of failure this product exists to abolish.
-keepclassmembers class ink.warrant.contract.** { *; }
-keep class ink.warrant.contract.** { *; }
-keep class ink.warrant.data.** { *; }

# The serializer that kotlinx.serialization generates for each @Serializable type.
-keepclassmembers class ** {
    *** Companion;
}
-keepclasseswithmembers class ** {
    kotlinx.serialization.KSerializer serializer(...);
}
