/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.silkframework.workspace

import java.util.concurrent.{Executors, ScheduledFuture, TimeUnit}
import java.util.logging.{Level, Logger}

import org.silkframework.config.{PlainTask, Task, MetaData, TaskSpec}
import org.silkframework.runtime.activity.{HasValue, Status}
import org.silkframework.runtime.plugin.PluginRegistry
import org.silkframework.util.Identifier
import org.silkframework.workspace.activity.{TaskActivity, TaskActivityFactory}

import scala.reflect.ClassTag
import scala.util.control.NonFatal


/**
  * A task that belongs to a project.
  * [[ProjectTask]] instances are mutable, this means that the task data returned on successive calls can be different.
  *
  * @tparam TaskType The data type that specifies the properties of this task.
  */
class ProjectTask[TaskType <: TaskSpec : ClassTag](val id: Identifier,
                                                   initialData: TaskType,
                                                   initialMetaData: MetaData,
                                                   module: Module[TaskType]) extends Task[TaskType] {

  private val log = Logger.getLogger(getClass.getName)

  @volatile
  private var currentData: TaskType = initialData

  @volatile
  private var currentMetaData: MetaData = initialMetaData

  @volatile
  private var scheduledWriter: Option[ScheduledFuture[_]] = None

  private val taskActivities: Seq[TaskActivity[TaskType, _ <: HasValue]] = {
    // Get all task activity factories for this task type
    implicit val prefixes = module.project.config.prefixes
    implicit val resources = module.project.resources
    val factories = PluginRegistry.availablePlugins[TaskActivityFactory[TaskType, _ <: HasValue]].map(_.apply()).filter(_.isTaskType[TaskType])
    var activities = List[TaskActivity[TaskType, _ <: HasValue]]()
    for (factory <- factories) {
      try {
        activities ::= new TaskActivity(this, factory)
      } catch {
        case NonFatal(ex) =>
          log.log(Level.WARNING, s"Could not load task activity '$factory' in task '$id' in project '${module.project.name}'.", ex)
      }
    }
    activities.reverse
  }

  private val taskActivityMap: Map[Class[_], TaskActivity[TaskType, _ <: HasValue]] = taskActivities.map(a => (a.activityType, a)).toMap

  /**
    * The project this task belongs to.
    */
  def project: Project = module.project

  /**
    * Retrieves the current data of this task.
    */
  override def data: TaskType = currentData

  /**
    * Retrieves the current meta data of this task.
    */
  override def metaData = currentMetaData

  def init(): Unit = {
    // Start auto-run activities
    for (activity <- taskActivities if activity.autoRun && activity.status == Status.Idle())
      activity.control.start()
  }

  /**
    * Updates the data of this task.
    */
  def update(newData: TaskType, newMetaData: Option[MetaData] = None): Unit = synchronized {
    // Update data
    currentData = newData
    for(md <- newMetaData) {
      currentMetaData = md
    }
    // (Re)Schedule write
    for (writer <- scheduledWriter) {
      writer.cancel(false)
    }
    scheduledWriter = Some(ProjectTask.scheduledExecutor.schedule(Writer, ProjectTask.writeInterval, TimeUnit.SECONDS))
    log.info("Updated task '" + id + "'")
  }

  /**
    * Updates the meta data of this task.
    */
  def updateMetaData(newMetaData: MetaData): Unit = {
    update(currentData, Some(newMetaData))
  }

  /**
    * Flushes this project task. i.e., the data of this task is written to the workspace provider immediately.
    * It is usually not needed to call this method, as task data is written to the workspace provider after a fixed interval without changes.
    * This method forces the writing and returns after all data has been written.
    */
  def flush(): Unit = synchronized {
    // Cancel any scheduled writer
    for (writer <- scheduledWriter) {
      writer.cancel(false)
    }
    // Write now
    Writer.run()
  }

  /**
    * All activities that belong to this task.
    */
  def activities: Seq[TaskActivity[TaskType, _]] = taskActivities

  /**
    * Retrieves an activity by type.
    *
    * @tparam T The type of the requested activity
    * @return The activity control for the requested activity
    */
  def activity[T <: HasValue : ClassTag]: TaskActivity[TaskType, T] = {
    val requestedClass = implicitly[ClassTag[T]].runtimeClass
    val act = taskActivityMap.getOrElse(requestedClass,
      throw new NoSuchElementException(s"Task '$id' in project '${project.name}' does not contain an activity of type '${requestedClass.getName}'. " +
        s"Available activities:\n${taskActivityMap.keys.map(_.getName).mkString("\n ")}"))
    act.asInstanceOf[TaskActivity[TaskType, T]]
  }

  /**
    * Retrieves an activity by name.
    *
    * @param activityName The name of the requested activity
    * @return The activity control for the requested activity
    */
  def activity(activityName: String): TaskActivity[TaskType, _ <: HasValue] = {
    taskActivities.find(_.name == activityName)
        .getOrElse(throw new NoSuchElementException(s"Task '$id' in project '${project.name}' does not contain an activity named '$activityName'. " +
            s"Available activities: ${taskActivityMap.values.map(_.name).mkString(", ")}"))
  }

  /**
    * Finds all project tasks that reference this task.
    *
    * @param recursive Whether to return tasks that indirectly refer to this task.
    */
  def findDependentTasks(recursive: Boolean): Seq[ProjectTask[_]] = {
    // Find all tasks that reference this task
    val dependentTasks = project.allTasks.filter(_.data.referencedTasks.contains(id))

    if(!recursive) {
      dependentTasks
    } else {
      val indirectlyDependendTasks = dependentTasks.flatMap(_.findDependentTasks(true))
      indirectlyDependendTasks ++ dependentTasks
    }
  }

  private object Writer extends Runnable {
    override def run(): Unit = {
      // Write task
      module.provider.putTask(project.name, ProjectTask.this)
      log.info(s"Persisted task '$id' in project '${project.name}'")
      // Update caches
      for (activity <- taskActivities if activity.autoRun) {
        if(!activity.control.status().isRunning)
          activity.control.start()
      }
    }
  }

  override def toString: String = {
    s"ProjectTask(id=$id, data=${currentData.toString}, metaData=${metaData.toString})"
  }

  // Returns all non-empty meta data fields as key value pairs
  def metaDataFields(): Seq[(String, String)] = {
    // ID is part of the metaData
    var metaDataFields: Vector[(String, String)] = Vector(("Task identifier", id.toString))
    if(metaData.label.trim != "") {
      metaDataFields = metaDataFields :+ "Label" -> metaData.label
    }
    if(metaData.description.trim != "") {
      metaDataFields = metaDataFields :+ "Description" -> metaData.description
    }
    metaDataFields
  }

  private val dotDotDot = '…'
  private val DEFAULT_MAX_LENGTH = 50

  /**
    * Returns the label if defined or the task ID. Truncates the label to maxLength characters.
    * @param maxLength the max length in characters
    */
  def taskLabel(maxLength: Int = DEFAULT_MAX_LENGTH): String = {
    assert(maxLength > 5, "maxLength for task label must be at least 5 chars long")
    val label = if(metaData.label.trim != "") {
      metaData.label.trim
    } else {
      id.toString
    }
    if(label.length > maxLength) {
      val sideLength = (maxLength - 2) / 2
      label.take(sideLength) + s" $dotDotDot " + label.takeRight(sideLength)
    } else {
      label
    }
  }
}

object ProjectTask {

  /* Do not persist updates more frequently than this (in seconds) */
  private val writeInterval = 3

  private val scheduledExecutor = Executors.newSingleThreadScheduledExecutor()
}